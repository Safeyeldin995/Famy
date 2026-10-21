import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type BookingParty = {
  booking_id: string;
  viewer_role: string;
  other_user_id: string;
  other_name: string | null;
  other_avatar_url: string | null;
  other_phone: string | null;
  area: string | null;
  zone_name_en: string | null;
  zone_name_ar: string | null;
  member_first_name: string | null;
  member_age_years: number | null;
};

const RPC_BATCH = 200;

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

async function withCustomerParties<T extends { id: string; customer?: unknown }>(
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const parties = await fetchBookingParties(rows.map((row) => row.id)).catch(
    () => new Map<string, never>(),
  );
  return rows.map((row) => {
    const party = parties.get(row.id);
    if (!party) return row;
    const current = (row.customer ?? {}) as {
      full_name?: string | null;
      avatar_url?: string | null;
      phone?: string | null;
    };
    return {
      ...row,
      party,
      customer: {
        ...current,
        full_name: party.other_name ?? current.full_name ?? null,
        avatar_url: party.other_avatar_url ?? current.avatar_url ?? null,
        phone: party.other_phone ?? null,
      },
    };
  });
}

export function useBookingParty(bookingId: string | null | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ["booking-party", bookingId],
    queryFn: async () => {
      const parties = await fetchBookingParties([bookingId!]);
      return parties.get(bookingId!) ?? null;
    },
  });
}

export { withCustomerParties };
