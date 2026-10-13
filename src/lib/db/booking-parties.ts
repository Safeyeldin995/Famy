import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isPreviewRoute } from "@/lib/preview/constants";

export type BookingParty = {
  booking_id: string;
  viewer_role: string;
  other_user_id: string;
  other_name: string | null;
  other_avatar_url: string | null;
  /** Only returned while the booking is active (confirmed .. completion_requested). */
  other_phone: string | null;
  area: string | null;
  zone_name_en: string | null;
  zone_name_ar: string | null;
  member_first_name: string | null;
  member_age_years: number | null;
};

const RPC_BATCH = 200;

/**
 * The other party of each booking (name, avatar, and the phone only while the
 * booking is active). `profiles` is self-only under RLS, so a plain join
 * returns null; `booking_party_profiles` checks that the caller is a party to
 * every booking. Ids are sent in batches the RPC accepts.
 */
export async function fetchBookingParties(
  bookingIds: string[],
): Promise<Map<string, BookingParty>> {
  const ids = [...new Set(bookingIds.filter(Boolean))];
  const parties = new Map<string, BookingParty>();
  for (let i = 0; i < ids.length; i += RPC_BATCH) {
    const { data, error } = await supabase.rpc("booking_party_profiles", {
      p_booking_ids: ids.slice(i, i + RPC_BATCH),
    });
    if (error) throw error;
    for (const row of data ?? []) parties.set(row.booking_id, row as BookingParty);
  }
  return parties;
}

export function useBookingParties(bookingIds: (string | null | undefined)[]) {
  const ids = [...new Set(bookingIds.filter((id): id is string => !!id))].sort();
  return useQuery({
    enabled: ids.length > 0 && !isPreviewRoute(),
    queryKey: ["booking-parties", ids],
    queryFn: () => fetchBookingParties(ids),
  });
}

export function useBookingParty(bookingId: string | null | undefined) {
  const q = useBookingParties([bookingId]);
  return { ...q, party: bookingId ? (q.data?.get(bookingId) ?? null) : null };
}
