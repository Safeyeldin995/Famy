import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { AddressInput } from "./bookingQueries";
import {
  ADDRESSES_QUERY_ROOT,
  ADDRESS_QUERY_ROOT,
  DEFAULT_ADDRESS_QUERY_ROOT,
} from "@shared/db/address-query-keys";

export function useSaveCustomerSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      address: AddressInput;
      addressId?: string;
      contactPhone?: string;
    }) => {
      const { data, error } = await supabase.rpc("save_customer_setup", {
        p_full_name: input.name.trim(),
        p_address: input.address,
        p_address_id: input.addressId ?? null,
        p_contact_phone: input.contactPhone ?? null,
      });
      if (error) throw error; // Never fall back to two non-atomic client writes.
      return data as string;
    },
    onSuccess: async () => {
      await Promise.all(
        ["my-profile", ADDRESSES_QUERY_ROOT, ADDRESS_QUERY_ROOT, DEFAULT_ADDRESS_QUERY_ROOT].map(
          (key) => qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
}
