import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  assertDirectBookingInsertDenied,
  cleanupBookingFixture,
  createOtpIntegrationClient,
  futureSlot,
  probeCreateBookingRpc,
  rpcCreateBooking,
  seedBookingFixture,
  supabaseUrl,
  type BookingFixture,
} from "./booking.harness";
import { IntegrationFixtureRegistry } from "@/lib/qa/integrationFixtureRegistry";
import { assertRunOwnedAdminsRemoved } from "@/lib/qa/integrationFixtureTeardown";
import { parseBookingErrorCode } from "@/lib/booking/errors";

const admin = createOtpIntegrationClient();
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const describeIf = admin && supabaseUrl && anonKey ? describe : describe.skip;

describeIf("booking create_booking RPC integrity", () => {
  const registry = new IntegrationFixtureRegistry({ suite: "booking.integration" });
  let fixture!: BookingFixture;
  const createdBookingIds: string[] = [];

  beforeAll(async () => {
    const probe = await probeCreateBookingRpc(admin!);
    if (probe.error?.code === "PGRST202") {
      throw new Error("create_booking RPC not found — apply PATCH 6A migration first");
    }
    fixture = await seedBookingFixture(admin!, anonKey!, registry);
  }, 300_000);

  afterAll(async () => {
    if (!admin) return;
    if (fixture) {
      await cleanupBookingFixture(admin, fixture, createdBookingIds);
    } else {
      const { teardownRegisteredFixture } = await import("@/lib/qa/integrationFixtureTeardown");
      await teardownRegisteredFixture(admin, registry);
    }
    await assertRunOwnedAdminsRemoved(admin, registry.getRunOwnedAdminUserIds());
  }, 120_000);

  function trackBookingId(result: { data: unknown }) {
    const payload = result.data as { booking_id?: string } | null;
    const id = payload?.booking_id;
    if (id && !createdBookingIds.includes(id)) {
      createdBookingIds.push(id);
      registry.registerBooking(id);
    }
    return id;
  }

  it("denies direct customer INSERT for an eligible provider without creating a row", async () => {
    const slot = futureSlot(96);
    await assertDirectBookingInsertDenied(
      admin!,
      fixture!.customerAClient,
      {
        customer_id: fixture.customerAId,
        provider_id: fixture.providerId,
        service_id: fixture.serviceId,
        address_id: fixture.addressAId,
        start_at: slot.start.toISOString(),
        end_at: slot.end.toISOString(),
        status: "pending",
        price_subtotal: 100,
        price_total: 100,
      },
      { customerId: fixture.customerAId },
    );
  });

  it("creates a booking through create_booking RPC", async () => {
    const slot = futureSlot(120);
    const result = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
      notes: "QA booking integration",
    });
    expect(result.error).toBeNull();
    const bookingId = trackBookingId(result);
    expect(bookingId).toBeTruthy();
    const { data: booking } = await admin!.from("bookings").select("status, customer_id, price_subtotal, price_total").eq("id", bookingId!).single();
    expect(booking?.status).toBe("pending");
    expect(booking?.customer_id).toBe(fixture.customerAId);
    expect(booking?.price_subtotal).toBeGreaterThan(0);
    expect(booking?.price_total).toBeGreaterThan(booking!.price_subtotal);
  });

  it("replays an idempotent retry with the same key", async () => {
    const slot = futureSlot(144);
    const key = randomUUID();
    const first = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: key,
    });
    expect(first.error).toBeNull();
    const bookingId = trackBookingId(first);
    const second = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: key,
    });
    expect(second.error).toBeNull();
    expect((second.data as { idempotent_replay?: boolean }).idempotent_replay).toBe(true);
    expect((second.data as { booking_id?: string }).booking_id).toBe(bookingId);
    const { count } = await admin!.from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", fixture.customerAId)
      .eq("idempotency_key", key);
    expect(count).toBe(1);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const slot = futureSlot(168);
    const key = randomUUID();
    const first = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: key,
      notes: "first payload",
    });
    expect(first.error).toBeNull();
    trackBookingId(first);
    const conflict = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: key,
      notes: "different payload",
    });
    expect(conflict.error).toBeTruthy();
    expect(parseBookingErrorCode(conflict.error!.message)).toBe("DUPLICATE_REQUEST_CONFLICT");
  });

  it("allows only one winner for the same slot across two customers", async () => {
    const slot = futureSlot(192);
    const [a, b] = await Promise.all([
      rpcCreateBooking(fixture.customerAClient, {
        provider_id: fixture.providerId,
        service_id: fixture.serviceId,
        address_id: fixture.addressAId,
        start_at: slot.start.toISOString(),
        end_at: slot.end.toISOString(),
        idempotency_key: randomUUID(),
      }),
      rpcCreateBooking(fixture.customerBClient, {
        provider_id: fixture.providerId,
        service_id: fixture.serviceId,
        address_id: fixture.addressBId,
        start_at: slot.start.toISOString(),
        end_at: slot.end.toISOString(),
        idempotency_key: randomUUID(),
      }),
    ]);
    const successes = [a, b].filter((r) => !r.error);
    const failures = [a, b].filter((r) => r.error);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(parseBookingErrorCode(failures[0].error!.message)).toBe("SLOT_UNAVAILABLE");
    trackBookingId(successes[0]);
  });

  it("rejects stale eligibility through create_booking when provider is suspended", async () => {
    await fixture.adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: fixture.providerId,
      p_action: "suspend",
      p_reason_code: "qa_booking_suspend",
      p_reason_public: "QA booking suspend",
    });
    const slot = futureSlot(216);
    const result = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
    });
    expect(result.error).toBeTruthy();
    expect(parseBookingErrorCode(result.error!.message)).toBe("PROVIDER_INELIGIBLE");
    await fixture.adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: fixture.providerId,
      p_action: "unsuspend",
    });
  });

  it("rejects booking when service is deactivated", async () => {
    await admin!.from("services").update({ is_active: false }).eq("id", fixture.serviceId);
    const slot = futureSlot(240);
    const result = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
    });
    expect(result.error).toBeTruthy();
    expect(parseBookingErrorCode(result.error!.message)).toBe("PROVIDER_INELIGIBLE");
    await admin!.from("services").update({ is_active: true }).eq("id", fixture.serviceId);
  });

  it("rejects booking when provider is removed from zone", async () => {
    await admin!.from("zone_providers").delete().eq("zone_id", fixture.zoneId).eq("provider_id", fixture.providerId);
    const slot = futureSlot(264);
    const result = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
    });
    expect(result.error).toBeTruthy();
    expect(parseBookingErrorCode(result.error!.message)).toBe("PROVIDER_INELIGIBLE");
    await admin!.from("zone_providers").insert({ zone_id: fixture.zoneId, provider_id: fixture.providerId });
  });

  it("rejects booking when provider is on vacation", async () => {
    await admin!.from("providers").update({ vacation_mode: true }).eq("id", fixture.providerId);
    const slot = futureSlot(288);
    const result = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
    });
    expect(result.error).toBeTruthy();
    expect(parseBookingErrorCode(result.error!.message)).toBe("PROVIDER_INELIGIBLE");
    await admin!.from("providers").update({ vacation_mode: false }).eq("id", fixture.providerId);
  });

  it("rejects booking when availability rules are removed", async () => {
    await admin!.from("availability_rules").delete().eq("provider_id", fixture.providerId);
    const slot = futureSlot(312);
    const result = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
    });
    expect(result.error).toBeTruthy();
    expect(parseBookingErrorCode(result.error!.message)).toBe("PROVIDER_INELIGIBLE");
    for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
      await admin!.from("availability_rules").insert({
        provider_id: fixture.providerId,
        weekday,
        start_time: "08:00",
        end_time: "20:00",
      });
    }
  });

  it("enforces cross-account RLS on bookings", async () => {
    const slot = futureSlot(336);
    const created = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
    });
    expect(created.error).toBeNull();
    const bookingId = trackBookingId(created)!;
    const { data: foreignRead } = await fixture.customerBClient.from("bookings").select("id").eq("id", bookingId).maybeSingle();
    expect(foreignRead).toBeNull();
    await fixture.otherProviderClient.from("bookings")
      .update({ status: "confirmed" })
      .eq("id", bookingId);
    const { data: afterForeignUpdate } = await admin!.from("bookings").select("status").eq("id", bookingId).single();
    expect(afterForeignUpdate?.status).toBe("pending");
  });

  it("handles concurrent cancel_booking safely", async () => {
    const slot = futureSlot(360);
    const created = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
    });
    expect(created.error).toBeNull();
    const bookingId = trackBookingId(created)!;
    const { data: reason } = await admin!.from("cancellation_reasons")
      .select("id")
      .eq("code", "customer_change_of_plans")
      .single();
    const [first, second] = await Promise.all([
      fixture.customerAClient.rpc("cancel_booking", {
        p_booking_id: bookingId,
        p_reason_id: reason!.id,
      }),
      fixture.customerAClient.rpc("cancel_booking", {
        p_booking_id: bookingId,
        p_reason_id: reason!.id,
      }),
    ]);
    const successes = [first, second].filter((r) => !r.error);
    expect(successes).toHaveLength(1);
    const { data: booking } = await admin!.from("bookings").select("status").eq("id", bookingId).single();
    expect(booking?.status).toBe("cancelled");
    const { count } = await admin!.from("booking_cancellations")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", bookingId);
    expect(count).toBe(1);
  });

  it("allows a changed payload with a new idempotency key after a prior submission", async () => {
    const slotA = futureSlot(408);
    const slotB = futureSlot(432);
    const sharedKey = randomUUID();
    const first = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slotA.start.toISOString(),
      end_at: slotA.end.toISOString(),
      idempotency_key: sharedKey,
      notes: "first slot",
    });
    expect(first.error).toBeNull();
    trackBookingId(first);

    const conflict = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slotB.start.toISOString(),
      end_at: slotB.end.toISOString(),
      idempotency_key: sharedKey,
      notes: "changed slot",
    });
    expect(conflict.error).toBeTruthy();
    expect(parseBookingErrorCode(conflict.error!.message)).toBe("DUPLICATE_REQUEST_CONFLICT");

    const changed = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slotB.start.toISOString(),
      end_at: slotB.end.toISOString(),
      idempotency_key: randomUUID(),
      notes: "changed slot",
    });
    expect(changed.error).toBeNull();
    trackBookingId(changed);
  });

  it("handles concurrent provider accept safely", async () => {
    const slot = futureSlot(384);
    const created = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
    });
    expect(created.error).toBeNull();
    const bookingId = trackBookingId(created)!;
    const [first, second] = await Promise.all([
      fixture.providerClient.from("bookings").update({ status: "confirmed" }).eq("id", bookingId),
      fixture.providerClient.from("bookings").update({ status: "confirmed" }).eq("id", bookingId),
    ]);
    const successes = [first, second].filter((r) => !r.error);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    const { data: booking } = await admin!.from("bookings").select("status").eq("id", bookingId).single();
    expect(booking?.status).toBe("confirmed");

    const { count: historyCount } = await admin!.from("booking_status_history")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", bookingId)
      .eq("from_status", "pending")
      .eq("to_status", "confirmed");
    expect(historyCount).toBe(1);

    const { data: notifications } = await admin!.from("notifications")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("type", "booking_confirmed");
    expect(notifications ?? []).toHaveLength(1);

    const { count: outboxCount } = await admin!.from("notification_outbox")
      .select("id", { count: "exact", head: true })
      .eq("notification_id", notifications![0]!.id);
    // Fixture has no push subscription row; outbox enqueue still runs because
    // missing notification_preferences defaults booking_push to true.
    expect(outboxCount).toBe(1);

    const repeat = await fixture.providerClient.from("bookings").update({ status: "confirmed" }).eq("id", bookingId);
    expect(repeat.error).toBeNull();
    const { data: repeatNotifications } = await admin!.from("notifications")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("type", "booking_confirmed");
    expect(repeatNotifications ?? []).toHaveLength(1);

    const { count: repeatOutboxCount } = await admin!.from("notification_outbox")
      .select("id", { count: "exact", head: true })
      .eq("notification_id", repeatNotifications![0]!.id);
    expect(repeatOutboxCount).toBe(1);
  });

  async function getActivePaymentMethodId() {
    const { data, error } = await admin!.from("payment_methods")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (error) throw error;
    return data.id;
  }

  it("rejects tampered payment amounts against bookings.price_total", async () => {
    const slot = futureSlot(1000);
    const created = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
    });
    expect(created.error).toBeNull();
    const bookingId = trackBookingId(created)!;
    const { data: booking } = await admin!.from("bookings")
      .select("price_total, customer_id, currency")
      .eq("id", bookingId)
      .single();
    const paymentMethodId = await getActivePaymentMethodId();

    const tampered = await fixture.customerAClient.from("payments").insert({
      booking_id: bookingId,
      customer_id: booking!.customer_id,
      payment_method_id: paymentMethodId,
      amount: Number(booking!.price_total) + 100,
      currency: booking!.currency ?? "EGP",
      status: "pending",
    } as any);
    expect(tampered.error).toBeTruthy();
    expect(String(tampered.error?.message ?? "")).toContain("Payment amount must match the booking total");

    const { count } = await admin!.from("payments")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", bookingId);
    expect(count).toBe(0);
  });

  it("creates payment using authoritative booking.price_total", async () => {
    const slot = futureSlot(1100);
    const created = await rpcCreateBooking(fixture.customerAClient, {
      provider_id: fixture.providerId,
      service_id: fixture.serviceId,
      address_id: fixture.addressAId,
      start_at: slot.start.toISOString(),
      end_at: slot.end.toISOString(),
      idempotency_key: randomUUID(),
    });
    expect(created.error).toBeNull();
    const bookingId = trackBookingId(created)!;
    const { data: booking } = await admin!.from("bookings")
      .select("price_total, customer_id, currency")
      .eq("id", bookingId)
      .single();
    const paymentMethodId = await getActivePaymentMethodId();

    const inserted = await fixture.customerAClient.from("payments").insert({
      booking_id: bookingId,
      customer_id: booking!.customer_id,
      payment_method_id: paymentMethodId,
      amount: Number(booking!.price_total),
      currency: booking!.currency ?? "EGP",
      status: "pending",
    } as any).select("amount").single();
    expect(inserted.error).toBeNull();
    expect(Number(inserted.data?.amount)).toBe(Number(booking!.price_total));
  });
});
