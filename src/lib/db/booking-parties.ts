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
  child_first_name: string | null;
  child_age_years: number | null;
};

/**
 * The other party of each booking (name, avatar, and the phone only while the
 * booking is active). `profiles` is self-only under RLS, so a plain join
 * returns null; this reads through `booking_party_profiles`, which checks
 * that the caller is a party to every booking.
 */
export function useBookingParties(bookingIds: (string | null | undefined)[]) {
  const ids = [...new Set(bookingIds.filter((id): id is string => !!id))].sort();
  return useQuery({
    enabled: ids.length > 0 && !isPreviewRoute(),
    queryKey: ["booking-parties", ids],
    queryFn: async (): Promise<Map<string, BookingParty>> => {
      const { data, error } = await supabase.rpc("booking_party_profiles", {
        p_booking_ids: ids,
      });
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.booking_id, row as BookingParty]));
    },
  });
}

export function useBookingParty(bookingId: string | null | undefined) {
  const q = useBookingParties([bookingId]);
  return { ...q, party: bookingId ? (q.data?.get(bookingId) ?? null) : null };
}
