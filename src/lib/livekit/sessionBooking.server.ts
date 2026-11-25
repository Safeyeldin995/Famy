import type { SupabaseAdminClient } from "@/lib/paymob/paymobCheckout.server";
import { paymentCapturedForJoin, type SessionBookingSnapshot } from "@/lib/livekit/sessionAccess";

const PENDING_REVIEW_MANUAL = "pending_review";

export async function loadSessionBookingSnapshot(
  supabaseAdmin: SupabaseAdminClient,
  bookingId: string,
): Promise<SessionBookingSnapshot | null> {
  const db = supabaseAdmin as any;
  const { data: booking, error } = await db
    .from("bookings")
    .select("id, service_mode, status, customer_id, provider_id, start_at, end_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking) return null;

  const { data: provider, error: provErr } = await db
    .from("providers")
    .select("profile_id")
    .eq("id", booking.provider_id)
    .maybeSingle();
  if (provErr) throw provErr;
  if (!provider?.profile_id) return null;
  const { data: payments, error: payErr } = await db
    .from("payments")
    .select("status, payment_method_type, proof_path")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (payErr) throw payErr;

  const payment_captured = (payments ?? []).some(
    (p: { status: string; payment_method_type: string | null }) => paymentCapturedForJoin(p),
  );

  return {
    id: booking.id,
    service_mode: (booking as { service_mode?: string }).service_mode ?? "in_person",
    status: booking.status,
    customer_id: booking.customer_id,
    provider_id: booking.provider_id,
    provider_profile_id: provider.profile_id,
    start_at: booking.start_at,
    end_at: booking.end_at,
    payment_captured,
  };
}