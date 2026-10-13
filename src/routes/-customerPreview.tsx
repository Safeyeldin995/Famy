import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { previewAddresses, previewBookings } from "@/lib/preview/mockData";
import {
  bookingPreviewCapability,
  bookingPreviewServices,
} from "@/lib/preview/customerBookingPreview";

type PreviewProvider = Record<string, unknown> & {
  hourly_rate: number;
  services: { price_override: number; service: (typeof bookingPreviewServices)[number] }[];
};
type PreviewConversation = Record<string, unknown> & {
  other?: Record<string, unknown>;
};

/** Preview-only: reuse the existing isolated fixtures with current customer query keys. */
export function CustomerPreview({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useState(() => {
    const provider = qc.getQueryData<PreviewProvider>(["provider", "p1", "addr-1"]);
    if (!provider) return true;
    for (const categorySlug of ["babysitting", "tutoring"]) {
      const services = provider.services.filter(
        (row) => row.service.category.slug === categorySlug,
      );
      const row = {
        ...provider,
        is_top_pro: false,
        hourly_rate: services[0]?.price_override ?? provider.hourly_rate,
        services,
      };
      for (const limit of [20, 60]) {
        for (const addressId of [undefined, "addr-1"]) {
          for (const serviceId of [undefined, ...services.map((s) => s.service.id)]) {
            qc.setQueryData(["providers", { categorySlug, addressId, serviceId, limit }], [row]);
          }
        }
      }
    }
    qc.setQueryData(["approved-teaching-capabilities", "p1", null], [bookingPreviewCapability]);
    qc.setQueryData(["approved-teaching-capabilities-many", ["p1"]], [bookingPreviewCapability]);
    qc.setQueryData(
      ["my-bookings"],
      previewBookings.map((booking) => ({ ...booking, provider })),
    );
    for (const booking of previewBookings) {
      qc.setQueryData(["booking", booking.id], {
        ...booking,
        provider,
        location: previewAddresses[0],
      });
      qc.setQueryData(["conversation-by-booking", booking.id, "open"], "conv-1");
    }
    // Keep old preview-only stock avatar URLs out of customer screenshots.
    for (const [key, value] of qc.getQueriesData<Record<string, unknown>[]>({
      queryKey: ["conversations"],
    })) {
      if (Array.isArray(value))
        qc.setQueryData(
          key,
          value.map((c) => ({ ...c, other_avatar: null })),
        );
    }
    const conversation = qc.getQueryData<PreviewConversation>(["conversation", "conv-1"]);
    if (conversation)
      qc.setQueryData(["conversation", "conv-1"], {
        ...conversation,
        other: { ...conversation.other, avatar_url: null },
      });
    return true;
  });
  // Preview path helpers depend on window; render the same shell during SSR and hydration.
  return mounted ? <>{children}</> : <div className="min-h-dvh bg-white" aria-busy="true" />;
}
