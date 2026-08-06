import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { IntegrationFixtureRegistry } from "@/lib/qa/integrationFixtureRegistry";
import {
  assertRunOwnedAdminsRemoved,
  teardownRegisteredFixture,
} from "@/lib/qa/integrationFixtureTeardown";
import { requireSeededCategory } from "@/lib/qa/seedCategory";
import { createAuthedClient } from "@/lib/booking/__tests__/booking.harness";

export type ProviderHarnessContext = {
  registry: IntegrationFixtureRegistry;
  admin: SupabaseClient<Database>;
  anonKey: string;
};

export async function createRegisteredAuthUser(
  ctx: ProviderHarnessContext,
  params: {
    email: string;
    password: string;
    role: "customer" | "provider" | "admin";
    fullName: string;
    phone: string;
    admin?: boolean;
  },
) {
  const { data, error } = await ctx.admin.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = data.user!.id;
  ctx.registry.registerUser(userId, { email: params.email, admin: params.admin ?? params.role === "admin" });
  ctx.registry.registerRole(userId, params.role);
  if (params.role === "provider") {
    await ctx.admin.from("user_roles").delete().eq("user_id", userId).eq("role", "customer");
  }
  await ctx.admin.from("user_roles").upsert({ user_id: userId, role: params.role });
  await ctx.admin.from("profiles").upsert({
    id: userId,
    full_name: params.fullName,
    phone: params.phone,
  });
  return userId;
}

export async function startRegisteredProvider(
  ctx: ProviderHarnessContext,
  client: SupabaseClient<Database>,
) {
  const { data, error } = await client.rpc("provider_start_onboarding");
  if (error) throw error;
  const providerId = (data as { id: string }).id;
  ctx.registry.registerProvider(providerId);
  return providerId;
}

export async function registerQaService(
  ctx: ProviderHarnessContext,
  params: { slug: string; name: string; categorySlug?: string },
) {
  const categoryId = await requireSeededCategory(ctx.admin, params.categorySlug ?? "home-cleaning");
  const { data, error } = await ctx.admin.from("services").insert({
    category_id: categoryId,
    slug: params.slug,
    name_en: params.name,
    name_ar: params.name,
    pricing_model: "hourly",
    base_price: 100,
    is_active: true,
  }).select("id").single();
  if (error) throw error;
  ctx.registry.registerService(data.id);
  return data.id;
}

export async function registerQaZone(
  ctx: ProviderHarnessContext,
  params: { name: string; providerId?: string },
) {
  const { data, error } = await ctx.admin.from("zones").insert({
    name_en: params.name,
    name_ar: params.name,
    boundary_type: "polygon",
    is_active: true,
    polygon: [{ lat: 30, lng: 31 }, { lat: 30, lng: 31.01 }, { lat: 30.01, lng: 31 }],
  }).select("id").single();
  if (error) throw error;
  ctx.registry.registerZone(data.id);
  if (params.providerId) {
    await ctx.admin.from("zone_providers").upsert({ zone_id: data.id, provider_id: params.providerId });
    ctx.registry.registerZoneProvider(data.id, params.providerId);
  }
  return data.id;
}

export async function cleanupProviderHarness(ctx: ProviderHarnessContext) {
  await teardownRegisteredFixture(ctx.admin, ctx.registry);
  await assertRunOwnedAdminsRemoved(ctx.admin, ctx.registry.getRunOwnedAdminUserIds());
}

export async function withRegisteredEphemeralUser<T>(
  ctx: ProviderHarnessContext,
  params: {
    email: string;
    password: string;
    role: "customer" | "provider" | "admin";
    fullName: string;
    phone: string;
    admin?: boolean;
  },
  fn: (args: {
    userId: string;
    client: SupabaseClient<Database>;
    ephemeral: IntegrationFixtureRegistry;
  }) => Promise<T>,
): Promise<T> {
  const ephemeral = new IntegrationFixtureRegistry({
    suite: ctx.registry.snapshot().suite,
    runId: `${ctx.registry.getRunId()}-ephemeral`,
  });
  let userId = "";
  try {
    userId = await createRegisteredAuthUser({ ...ctx, registry: ephemeral }, params);
    const client = await createAuthedClient(params.email, params.password, ctx.anonKey);
    return await fn({ userId, client, ephemeral });
  } finally {
    await teardownRegisteredFixture(ctx.admin, ephemeral);
  }
}

export { createAuthedClient, requireSeededCategory };
