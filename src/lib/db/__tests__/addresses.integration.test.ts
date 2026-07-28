import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  createAuthedClient,
  createOtpIntegrationClient,
  supabaseUrl,
} from "@/lib/booking/__tests__/booking.harness";

type PolicyRow = { policyname: string; cmd: string };

export const EXPECTED_ADDRESS_POLICIES: PolicyRow[] = [
  { policyname: "addresses_self", cmd: "ALL" },
];

function queryLinkedDb<T>(sql: string): T[] {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  const output = execSync(`npx supabase db query --linked ${JSON.stringify(oneLine)}`, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  const parsed = JSON.parse(output) as { rows?: T[] };
  return parsed.rows ?? [];
}

export function verifyAddressesOwnerOnlyPolicyState(): {
  policies: PolicyRow[];
  rlsEnabled: boolean;
} {
  const policies = queryLinkedDb<PolicyRow>(`
    SELECT policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'addresses'
    ORDER BY policyname, cmd
  `);
  const rlsRows = queryLinkedDb<{ relrowsecurity: boolean }>(`
    SELECT c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'addresses'
  `);
  return { policies, rlsEnabled: rlsRows[0]?.relrowsecurity === true };
}

type PartialFixtureState = {
  userIds: string[];
  addressIds: string[];
  bookingIds: string[];
};

async function cleanupPartialFixture(
  admin: SupabaseClient<Database>,
  state: PartialFixtureState,
) {
  if (state.bookingIds.length > 0) {
    await admin.from("bookings").delete().in("id", [...new Set(state.bookingIds)]);
  }
  if (state.addressIds.length > 0) {
    await admin.from("addresses").delete().in("id", [...new Set(state.addressIds)]);
  }
  for (const userId of [...new Set(state.userIds)]) {
    await admin.from("user_roles").delete().eq("user_id", userId);
    await admin.from("profiles").delete().eq("id", userId);
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      // Idempotent: user may already be removed.
    }
  }
}

type AddressFixture = {
  customerAId: string;
  customerBId: string;
  dualRoleAdminId: string;
  addressAId: string;
  addressBId: string;
  adminOwnAddressId: string;
  bookingId: string;
  bookingFixtureCreated: boolean;
  customerAClient: SupabaseClient<Database>;
  customerBClient: SupabaseClient<Database>;
  dualRoleAdminClient: SupabaseClient<Database>;
};

async function seedAddressFixture(
  admin: SupabaseClient<Database>,
  anonKey: string,
): Promise<AddressFixture> {
  const stamp = Date.now();
  const password = "QaAddressIso123!";
  const customerAEmail = `qa-address-a-${stamp}@famio.local`;
  const customerBEmail = `qa-address-b-${stamp}@famio.local`;
  const dualAdminEmail = `qa-address-admin-${stamp}@famio.local`;
  const partial: PartialFixtureState = { userIds: [], addressIds: [], bookingIds: [] };

  try {
    async function createCustomer(email: string, phoneSuffix: string) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      const userId = data.user!.id;
      partial.userIds.push(userId);

      // handle_new_user already inserts profiles + customer role.
      const { error: profileError } = await admin.from("profiles").update({
        full_name: email,
        phone: `+2018${phoneSuffix.padStart(8, "0").slice(-8)}`,
      }).eq("id", userId);
      if (profileError) throw profileError;

      return userId;
    }

    const customerAId = await createCustomer(customerAEmail, `${stamp}01`);
    const customerBId = await createCustomer(customerBEmail, `${stamp}02`);
    const dualRoleAdminId = await createCustomer(dualAdminEmail, `${stamp}03`);

    const { error: adminRoleError } = await admin
      .from("user_roles")
      .upsert({ user_id: dualRoleAdminId, role: "admin" }, { onConflict: "user_id,role" });
    if (adminRoleError) throw adminRoleError;

    async function insertAddress(userId: string, label: string) {
      const { data, error } = await admin.from("addresses").insert({
        user_id: userId,
        label: "home",
        city: "Cairo",
        area: label,
        street: label,
        line1: label,
        lat: 30.02,
        lng: 31.02,
        is_default: true,
      }).select("id").single();
      if (error) throw error;
      partial.addressIds.push(data.id);
      return data.id;
    }

    const addressAId = await insertAddress(customerAId, `QA_ISO_A_${stamp}`);
    const addressBId = await insertAddress(customerBId, `QA_ISO_B_${stamp}`);
    const adminOwnAddressId = await insertAddress(dualRoleAdminId, `QA_ISO_ADMIN_${stamp}`);

    const { data: existingLocation, error: locationLookupError } = await admin
      .from("booking_locations")
      .select("booking_id")
      .limit(1)
      .maybeSingle();
    if (locationLookupError) throw locationLookupError;
    if (!existingLocation) {
      throw new Error("No booking_locations row available for admin read fixture");
    }

    return {
      customerAId,
      customerBId,
      dualRoleAdminId,
      addressAId,
      addressBId,
      adminOwnAddressId,
      bookingId: existingLocation.booking_id,
      bookingFixtureCreated: false,
      customerAClient: await createAuthedClient(customerAEmail, password, anonKey),
      customerBClient: await createAuthedClient(customerBEmail, password, anonKey),
      dualRoleAdminClient: await createAuthedClient(dualAdminEmail, password, anonKey),
    };
  } catch (error) {
    await cleanupPartialFixture(admin, partial);
    throw error;
  }
}

async function cleanupAddressFixture(admin: SupabaseClient<Database>, fixture: AddressFixture) {
  await cleanupPartialFixture(admin, {
    userIds: [fixture.customerAId, fixture.customerBId, fixture.dualRoleAdminId],
    addressIds: [fixture.addressAId, fixture.addressBId, fixture.adminOwnAddressId],
    bookingIds: fixture.bookingFixtureCreated ? [fixture.bookingId] : [],
  });
}

export async function countAdminRoleHolders(admin: SupabaseClient<Database>): Promise<number> {
  const { count, error } = await admin
    .from("user_roles")
    .select("user_id", { count: "exact", head: true })
    .eq("role", "admin");
  if (error) throw error;
  return count ?? 0;
}

const admin = createOtpIntegrationClient();
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const describeIf = admin && supabaseUrl && anonKey ? describe : describe.skip;

describeIf("address PII isolation", () => {
  let fixture: AddressFixture;
  let adminCountBefore = 0;

  beforeAll(async () => {
    adminCountBefore = await countAdminRoleHolders(admin!);
    fixture = await seedAddressFixture(admin!, anonKey!);
  }, 180_000);

  afterAll(async () => {
    if (admin && fixture) await cleanupAddressFixture(admin, fixture);
    if (admin) {
      const adminCountAfter = await countAdminRoleHolders(admin);
      expect(adminCountAfter).toBe(adminCountBefore);
    }
  }, 60_000);

  it("verifies the exact owner-only addresses policy set with RLS enabled", () => {
    const { policies, rlsEnabled } = verifyAddressesOwnerOnlyPolicyState();
    expect(rlsEnabled).toBe(true);
    expect(policies).toEqual(EXPECTED_ADDRESS_POLICIES);
  }, 60_000);

  it("returns only customer A rows for customer A JWT", async () => {
    const { data, error } = await fixture.customerAClient
      .from("addresses")
      .select("id,user_id")
      .order("created_at");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
    expect(data?.every((row) => row.user_id === fixture.customerAId)).toBe(true);
    expect(data?.some((row) => row.id === fixture.addressAId)).toBe(true);
    expect(data?.some((row) => row.id === fixture.addressBId)).toBe(false);
  });

  it("denies customer A access to customer B address by id", async () => {
    const { data, error } = await fixture.customerAClient
      .from("addresses")
      .select("id")
      .eq("id", fixture.addressBId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("returns only own rows for dual-role admin+customer unfiltered SELECT", async () => {
    const { data, error } = await fixture.dualRoleAdminClient
      .from("addresses")
      .select("id,user_id")
      .order("created_at");
    expect(error).toBeNull();
    expect(data?.every((row) => row.user_id === fixture.dualRoleAdminId)).toBe(true);
    expect(data?.some((row) => row.id === fixture.adminOwnAddressId)).toBe(true);
    expect(data?.some((row) => row.id === fixture.addressAId)).toBe(false);
    expect(data?.some((row) => row.id === fixture.addressBId)).toBe(false);
  });

  it("returns only own row when dual-role admin filters by own address id", async () => {
    const { data, error } = await fixture.dualRoleAdminClient
      .from("addresses")
      .select("id,user_id")
      .eq("id", fixture.adminOwnAddressId)
      .eq("user_id", fixture.dualRoleAdminId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(fixture.adminOwnAddressId);
  });

  it("denies dual-role admin access to another customer's address by id", async () => {
    const { data, error } = await fixture.dualRoleAdminClient
      .from("addresses")
      .select("id")
      .eq("id", fixture.addressAId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("allows admin JWT to read a known booking_locations fixture row", async () => {
    const { data, error } = await fixture.dualRoleAdminClient
      .from("booking_locations")
      .select("booking_id")
      .eq("booking_id", fixture.bookingId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.booking_id).toBe(fixture.bookingId);
  });
});
