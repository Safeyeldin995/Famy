/**
 * Credentialed QA suite. Skips without env. Not native PG17 from PGlite.
 * This file is not executed remotely in the current correction; it remains
 * skip-without-env until a separate owner-approved QA run.
 *
 * afterAll is stage-1 dry-run only: persist pending teardown, perform zero
 * teardown writes, leave residue active. Resume is a separate owner-approved
 * call and must not reseed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createOtpIntegrationClient,
  supabaseUrl,
} from "@/lib/otp/__tests__/otpIntegration.harness";
import { IntegrationFixtureRegistry } from "@/lib/qa/integrationFixtureRegistry";
import { parseBookingErrorCode } from "@/lib/booking/errors";
import {
  cleanupBabysittingQaFixture,
  futureSlot,
  insertOwnedChild,
  monthsBeforeUtc,
  requireBabysittingCatalogue,
  rpcCreateBooking,
  seedBabysittingQaFixture,
  type ProviderHarnessContext,
} from "./babysittingCapabilities.harness";

const admin = createOtpIntegrationClient();
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const describeIf = admin && supabaseUrl && anonKey ? describe : describe.skip;

function errorText(error: { message?: string; code?: string } | null | undefined) {
  return `${error?.message ?? ""} ${error?.code ?? ""}`;
}

describeIf("babysitting capabilities credentialed QA", () => {
  const registry = new IntegrationFixtureRegistry({ suite: "babysittingCapabilities.integration" });
  const ctx: ProviderHarnessContext = { registry, admin: admin!, anonKey: anonKey! };
  let fixture: Awaited<ReturnType<typeof seedBabysittingQaFixture>> | undefined;
  const createdBookingIds: string[] = [];

  beforeAll(async () => {
    await requireBabysittingCatalogue(admin!);
    fixture = await seedBabysittingQaFixture(ctx);
  }, 300_000);

  afterAll(async () => {
    if (!admin) return;
    await cleanupBabysittingQaFixture(ctx, fixture?.adminClient, {
      persistPath: "qa/report/pr67-babysitting-pending-teardown.json",
      adminEmail: fixture?.adminEmail,
    });
  }, 120_000);

  function trackBooking(result: { data: unknown }) {
    const id = (result.data as { booking_id?: string } | null)?.booking_id;
    if (id) {
      createdBookingIds.push(id);
      registry.registerBooking(id);
    }
    return id;
  }

  it("denies unauthorized and self-action request_updated_details", async () => {
    const asCustomer = await fixture!.customerClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: fixture!.providerId,
      p_action: "request_updated_details",
      p_reason_code: "updated_details_required",
      p_reason_public: "Need declaration",
    });
    expect(asCustomer.error).not.toBeNull();

    const asProvider = await fixture!.providerClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: fixture!.providerId,
      p_action: "request_updated_details",
      p_reason_code: "updated_details_required",
      p_reason_public: "Need declaration",
    });
    expect(asProvider.error).not.toBeNull();

    const selfAction = await fixture!.providerAdminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: fixture!.providerAdminProviderId,
      p_action: "request_updated_details",
      p_reason_code: "updated_details_required",
      p_reason_public: "Need declaration",
    });
    expect(selfAction.error).not.toBeNull();
    expect(errorText(selfAction.error)).toMatch(/own provider|42501/i);

    const otherSave = await fixture!.otherClient.rpc("provider_save_onboarding_section", {
      p_section: "experience",
      p_payload: {
        bio_en: "hijack",
        years_experience: 1,
        age_group_capabilities: [{ code: "toddler", years_experience: 1 }],
        max_children_per_booking: 1,
      },
    });
    expect(otherSave.error).toBeNull();
    const { data: original } = await admin!
      .from("providers")
      .select("max_children_per_booking")
      .eq("id", fixture!.providerId)
      .single();
    expect(original?.max_children_per_booking).toBe(2);
  });

  it("opens APPROVED providers for declaration, blocks incomplete reapproval, then restores bookings", async () => {
    const slot = futureSlot(120);
    const childId = await insertOwnedChild(
      ctx,
      fixture!.customerId,
      monthsBeforeUtc(slot.start, 20),
    );
    const otherChildId = await insertOwnedChild(
      ctx,
      fixture!.otherUserId,
      monthsBeforeUtc(slot.start, 20),
    );

    const missingChild = await rpcCreateBooking(fixture!.customerClient, {
      provider_id: fixture!.providerId,
      service_id: fixture!.babysittingServiceId,
      address_id: fixture!.addressId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
      family_member_id: null,
    });
    expect(parseBookingErrorCode(missingChild.error?.message)).toBe("INVALID_BOOKING_REQUEST");
    expect(errorText(missingChild.error)).toMatch(/owned child family member/i);

    const otherOwner = await rpcCreateBooking(fixture!.customerClient, {
      provider_id: fixture!.providerId,
      service_id: fixture!.babysittingServiceId,
      address_id: fixture!.addressId,
      start_at: futureSlot(132).start.toISOString(),
      end_at: futureSlot(132).end.toISOString(),
      idempotency_key: randomUUID(),
      family_member_id: otherChildId,
    });
    expect(parseBookingErrorCode(otherOwner.error?.message)).toBe("UNAUTHORIZED");
    expect(errorText(otherOwner.error)).toMatch(/does not belong/i);

    const existing = await rpcCreateBooking(fixture!.customerClient, {
      provider_id: fixture!.providerId,
      service_id: fixture!.babysittingServiceId,
      address_id: fixture!.addressId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
      family_member_id: childId,
      notes: "existing babysitting booking",
    });
    expect(existing.error, existing.error?.message).toBeNull();
    const existingId = trackBooking(existing);
    expect(existingId).toBeTruthy();

    const missingReason = await fixture!.adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: fixture!.providerId,
      p_action: "request_updated_details",
      p_reason_code: "updated_details_required",
      p_reason_public: "   ",
    });
    expect(missingReason.error).not.toBeNull();

    const legacy = await fixture!.adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: fixture!.providerId,
      p_action: "request_changes",
      p_reason_code: "missing_info",
      p_reason_public: "Please update",
    });
    expect(legacy.error).not.toBeNull();

    const requested = await fixture!.adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: fixture!.providerId,
      p_action: "request_updated_details",
      p_reason_code: "updated_details_required",
      p_reason_public: "Need babysitting age-group declaration",
    });
    expect(requested.error, requested.error?.message).toBeNull();

    const after = await admin!
      .from("providers")
      .select("onboarding_status, review_reason_public, max_children_per_booking")
      .eq("id", fixture!.providerId)
      .single();
    expect(after.data?.onboarding_status).toBe("NEEDS_CHANGES");
    expect(after.data?.review_reason_public).toBe("Need babysitting age-group declaration");
    expect(after.data?.max_children_per_booking).toBe(2);

    const kept = await admin!.from("bookings").select("id, status").eq("id", existingId!).single();
    expect(kept.data?.status).toBe("pending");

    const ineligible = await rpcCreateBooking(fixture!.customerClient, {
      provider_id: fixture!.providerId,
      service_id: fixture!.babysittingServiceId,
      address_id: fixture!.addressId,
      start_at: futureSlot(168).start.toISOString(),
      end_at: futureSlot(168).end.toISOString(),
      idempotency_key: randomUUID(),
      family_member_id: childId,
    });
    expect(parseBookingErrorCode(ineligible.error?.message)).toBe("PROVIDER_INELIGIBLE");

    await admin!
      .from("providers")
      .update({ max_children_per_booking: null })
      .eq("id", fixture!.providerId);
    await admin!
      .from("provider_age_group_capabilities")
      .delete()
      .eq("provider_id", fixture!.providerId);

    const incompleteSubmit = await fixture!.providerClient.rpc("provider_submit_onboarding");
    expect(incompleteSubmit.error).toBeNull();
    expect(incompleteSubmit.data).toMatchObject({
      ok: false,
      errors: { experience: "babysitting_details_required" },
    });

    const incompleteApprove = await fixture!.adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: fixture!.providerId,
      p_action: "approve",
    });
    expect(incompleteApprove.error).not.toBeNull();

    const saved = await fixture!.providerClient.rpc("provider_save_onboarding_section", {
      p_section: "experience",
      p_payload: {
        bio_en: "QA babysitting bio",
        years_experience: 3,
        age_group_capabilities: [{ code: "toddler", years_experience: 3 }],
        max_children_per_booking: 2,
      },
    });
    expect(saved.error, saved.error?.message).toBeNull();

    const submitted = await fixture!.providerClient.rpc("provider_submit_onboarding");
    expect(submitted.error).toBeNull();
    expect((submitted.data as { ok?: boolean; status?: string }).ok).toBe(true);
    expect((submitted.data as { status?: string }).status).toBe("SUBMITTED");

    const reapproved = await fixture!.adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: fixture!.providerId,
      p_action: "approve",
    });
    expect(reapproved.error, reapproved.error?.message).toBeNull();

    const restored = await rpcCreateBooking(fixture!.customerClient, {
      provider_id: fixture!.providerId,
      service_id: fixture!.babysittingServiceId,
      address_id: fixture!.addressId,
      start_at: futureSlot(192).start.toISOString(),
      end_at: futureSlot(192).end.toISOString(),
      idempotency_key: randomUUID(),
      family_member_id: childId,
    });
    expect(restored.error, restored.error?.message).toBeNull();
    expect(trackBooking(restored)).toBeTruthy();
  });

  it("accepts same-band reschedule, rejects cross-band, and keeps cleaning create", async () => {
    const start = futureSlot(216);
    const childId = await insertOwnedChild(
      ctx,
      fixture!.customerId,
      monthsBeforeUtc(start.start, 35),
    );
    const created = await rpcCreateBooking(fixture!.customerClient, {
      provider_id: fixture!.providerId,
      service_id: fixture!.babysittingServiceId,
      address_id: fixture!.addressId,
      start_at: start.start.toISOString(),
      end_at: start.end.toISOString(),
      idempotency_key: randomUUID(),
      family_member_id: childId,
    });
    expect(created.error, created.error?.message).toBeNull();
    const bookingId = trackBooking(created)!;

    const sameBandEnd = new Date(start.start.getTime() + 24 * 60 * 60 * 1000);
    const sameBand = await fixture!.customerClient.rpc("request_reschedule", {
      p_booking_id: bookingId,
      p_proposed_start: sameBandEnd.toISOString(),
      p_proposed_end: new Date(sameBandEnd.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      p_reason: "same band",
    });
    expect(sameBand.error, sameBand.error?.message).toBeNull();
    const sameAccept = await fixture!.providerClient.rpc("respond_reschedule", {
      p_request_id: sameBand.data as string,
      p_action: "accept",
    });
    expect(sameAccept.error, sameAccept.error?.message).toBeNull();

    const crossStart = new Date(
      Date.UTC(
        start.start.getUTCFullYear(),
        start.start.getUTCMonth() + 2,
        start.start.getUTCDate(),
        10,
        0,
        0,
      ),
    );
    const cross = await fixture!.customerClient.rpc("request_reschedule", {
      p_booking_id: bookingId,
      p_proposed_start: crossStart.toISOString(),
      p_proposed_end: new Date(crossStart.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      p_reason: "cross band",
    });
    expect(cross.error, cross.error?.message).toBeNull();
    const crossAccept = await fixture!.providerClient.rpc("respond_reschedule", {
      p_request_id: cross.data as string,
      p_action: "accept",
    });
    expect(parseBookingErrorCode(crossAccept.error?.message)).toBe("PROVIDER_INELIGIBLE");
    expect(errorText(crossAccept.error)).toMatch(/does not support this child age group/i);

    const { data: requestState } = await admin!
      .from("booking_reschedule_requests")
      .select("status")
      .eq("id", cross.data as string)
      .single();
    expect(requestState?.status).toBe("pending");

    const { data: still } = await admin!
      .from("bookings")
      .select("start_at")
      .eq("id", bookingId)
      .single();
    expect(new Date(still!.start_at).toISOString()).toBe(sameBandEnd.toISOString());

    const cleaning = await rpcCreateBooking(fixture!.customerClient, {
      provider_id: fixture!.cleaningProviderId,
      service_id: fixture!.cleaningServiceId,
      address_id: fixture!.addressId,
      start_at: futureSlot(240).start.toISOString(),
      end_at: futureSlot(240).end.toISOString(),
      idempotency_key: randomUUID(),
    });
    expect(cleaning.error, cleaning.error?.message).toBeNull();
    expect(trackBooking(cleaning)).toBeTruthy();
  });
});
