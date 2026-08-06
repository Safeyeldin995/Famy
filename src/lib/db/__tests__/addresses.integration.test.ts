import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  assertNoRowReturned,
  assertRowsOwnedByUser,
} from "@/lib/qa/behavioralSecurity";
import {
  IntegrationFixtureRegistry,
  runRegisteredTeardown,
} from "@/lib/qa/integrationFixtureRegistry";
import {
  assertRunOwnedAdminsRemoved,
  teardownRegisteredFixture,
} from "@/lib/qa/integrationFixtureTeardown";
import {
  createAuthedClient,
  createOtpIntegrationClient,
  seedEligibleBookingForAddressFixture,
  supabaseUrl,
} from "@/lib/booking/__tests__/booking.harness";

type AddressFixture = {
  registry: IntegrationFixtureRegistry;
  customerAId: string;
  customerBId: string;
  dualRoleAdminId: string;
  addressAId: string;
  addressBId: string;
  adminOwnAddressId: string;
  bookingId: string;
  bookingAdminClient: SupabaseClient<Database>;
  customerAClient: SupabaseClient<Database>;
  customerBClient: SupabaseClient<Database>;
  dualRoleAdminClient: SupabaseClient<Database>;
};

async function seedAddressFixture(
  admin: SupabaseClient<Database>,
  anonKey: string,
  outerRegistry?: IntegrationFixtureRegistry,
): Promise<AddressFixture> {
  const registry = outerRegistry ?? new IntegrationFixtureRegistry({ suite: "addresses.integration" });
  const stamp = Date.now();
  const password = "QaAddressIso123!";
  const customerAEmail = `qa-address-a-${stamp}@famio.local`;
  const customerBEmail = `qa-address-b-${stamp}@famio.local`;
  const dualAdminEmail = `qa-address-admin-${stamp}@famio.local`;

  let bookingRpcClient: SupabaseClient<Database> | undefined;
  try {
    async function createCustomer(email: string, phoneSuffix: string) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      const userId = data.user!.id;
      registry.registerUser(userId, { email });
      registry.registerRole(userId, "customer");

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
    registry.registerUser(dualRoleAdminId, { email: dualAdminEmail, admin: true });
    registry.registerRole(dualRoleAdminId, "admin");

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
      registry.registerAddress(data.id);
      return data.id;
    }

    const addressAId = await insertAddress(customerAId, `QA_ISO_A_${stamp}`);
    const addressBId = await insertAddress(customerBId, `QA_ISO_B_${stamp}`);
    const adminOwnAddressId = await insertAddress(dualRoleAdminId, `QA_ISO_ADMIN_${stamp}`);

    const customerAClient = await createAuthedClient(customerAEmail, password, anonKey);

    const { bookingId, adminClient: bookingAdminClient } = await seedEligibleBookingForAddressFixture(admin, registry, {
      stamp,
      customerId: customerAId,
      addressId: addressAId,
      customerClient: customerAClient,
      anonKey,
    });
    bookingRpcClient = bookingAdminClient;

    const dualRoleAdminClient = await createAuthedClient(dualAdminEmail, password, anonKey);

    return {
      registry,
      customerAId,
      customerBId,
      dualRoleAdminId,
      addressAId,
      addressBId,
      adminOwnAddressId,
      bookingId,
      bookingAdminClient,
      customerAClient,
      customerBClient: await createAuthedClient(customerBEmail, password, anonKey),
      dualRoleAdminClient,
    };
  } catch (error) {
    await teardownRegisteredFixture(admin, registry, undefined, {
      bookingRpcClient,
    });
    throw error;
  }
}

const admin = createOtpIntegrationClient();
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const describeIf = admin && supabaseUrl && anonKey ? describe : describe.skip;

describeIf("address PII isolation", () => {
  let fixture: AddressFixture;
  const registry = new IntegrationFixtureRegistry({ suite: "addresses.integration" });

  beforeAll(async () => {
    fixture = await seedAddressFixture(admin!, anonKey!, registry);
  }, 180_000);

  afterAll(async () => {
    if (!admin) return;
    await runRegisteredTeardown(registry, async () => {
      await teardownRegisteredFixture(admin, registry, undefined, {
        bookingRpcClient: fixture.bookingAdminClient ?? fixture.dualRoleAdminClient,
      });
      await assertRunOwnedAdminsRemoved(admin, registry.getRunOwnedAdminUserIds());
    });
  }, 60_000);

  it("enforces owner-only address visibility for customer A JWT", async () => {
    const { data, error } = await fixture.customerAClient
      .from("addresses")
      .select("id,user_id")
      .order("created_at");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
    expect(assertRowsOwnedByUser(data, fixture.customerAId)).toBe(true);
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
    expect(assertNoRowReturned(data)).toBe(true);
  });

  it("returns only own rows for dual-role admin+customer unfiltered SELECT", async () => {
    const { data, error } = await fixture.dualRoleAdminClient
      .from("addresses")
      .select("id,user_id")
      .order("created_at");
    expect(error).toBeNull();
    expect(assertRowsOwnedByUser(data, fixture.dualRoleAdminId)).toBe(true);
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
    expect(data?.user_id).toBe(fixture.dualRoleAdminId);
  });

  it("denies dual-role admin access to another customer's address by id", async () => {
    const { data, error } = await fixture.dualRoleAdminClient
      .from("addresses")
      .select("id")
      .eq("id", fixture.addressAId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(assertNoRowReturned(data)).toBe(true);
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

export { IntegrationFixtureRegistry };
