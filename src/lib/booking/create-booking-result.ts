import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];

export type CreateBookingRpcPayload = {
  booking_id: string;
  created: boolean;
  idempotent_replay: boolean;
};

export type CompletedCreateBookingResult = BookingRow & {
  created: boolean;
  idempotent_replay: boolean;
  fetch_degraded?: boolean;
};

type FetchBooking = (
  bookingId: string,
) => Promise<{ data: BookingRow | null; error: unknown | null }>;

export async function completeCreateBookingResult(
  payload: CreateBookingRpcPayload,
  fetchBooking: FetchBooking,
  options: { retryDelayMs?: number } = {},
): Promise<CompletedCreateBookingResult> {
  const retryDelayMs = options.retryDelayMs ?? 250;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await fetchBooking(payload.booking_id);
    if (!error && data) {
      return {
        ...data,
        created: payload.created,
        idempotent_replay: payload.idempotent_replay,
      };
    }
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  console.error("[create_booking] post-create fetch failed", { bookingId: payload.booking_id });

  return {
    id: payload.booking_id,
    created: payload.created,
    idempotent_replay: payload.idempotent_replay,
    fetch_degraded: true,
  } as CompletedCreateBookingResult;
}

export function createBookingFetcher(client: SupabaseClient<Database>): FetchBooking {
  return async (bookingId) => {
    const { data, error } = await client
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();
    return { data: data ?? null, error: error ?? null };
  };
}
