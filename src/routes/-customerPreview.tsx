import { PREVIEW_USER_ID } from "@/lib/preview/constants";
import {
  addressesQueryKey,
  addressQueryKey,
  defaultAddressQueryKey,
} from "@/lib/db/address-query-keys";
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
    const address = {
      ...previewAddresses[0],
      street: "شارع 9",
      line1: "شارع 9",
      building: "12",
      compound: "دجلة",
    };
    qc.setQueryData(addressesQueryKey(PREVIEW_USER_ID), [address]);
    qc.setQueryData(addressQueryKey(PREVIEW_USER_ID, address.id), address);
    qc.setQueryData(defaultAddressQueryKey(PREVIEW_USER_ID), address);
    const members = [
      {
        id: "fm-1",
        full_name: "يوسف",
        relationship: "son",
        date_of_birth: "2020-05-12",
        gender: "male",
        is_active: true,
      },
    ];
    qc.setQueryData(["family-members"], members);
    qc.setQueryData(["family-member", "fm-1"], members[0]);
    qc.setQueryData(["notification-preferences"], {
      booking_push: true,
      message_push: true,
      reminder_push: true,
      support_push: true,
      campaign_push: false,
    });
    qc.setQueryData(["push-subscriptions"], []);
    qc.setQueryData(
      ["teaching-curricula", false],
      [
        {
          id: "egypt",
          code: "egypt",
          name_ar: "المنهج المصري",
          name_en: "Egyptian curriculum",
          is_active: true,
          sort_order: 0,
        },
      ],
    );
    qc.setQueryData(
      ["teaching-levels", false],
      [
        {
          id: "grade-1",
          code: "g1",
          name_ar: "الصف الأول",
          name_en: "Grade 1",
          is_active: true,
          sort_order: 0,
        },
      ],
    );
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    qc.setQueryData(
      ["notifications"],
      [
        {
          id: "n1",
          title_ar: "حجزك اتأكد",
          body_ar: "منى هتيجي في المعاد اللي اخترته. شوف تفاصيل الحجز.",
          title_en: "Booking confirmed",
          body_en: "View your booking details.",
          read_at: null,
          category: "booking",
          created_at: now.toISOString(),
          deep_link: "/bookings",
        },
        {
          id: "n2",
          title_ar: "شكرا على تقييمك",
          body_ar: "رأيك بيساعد العائلات تختار الخدمة المناسبة.",
          title_en: "Thanks for your review",
          body_en: "Your feedback helps families.",
          read_at: yesterday.toISOString(),
          category: "booking",
          created_at: yesterday.toISOString(),
          deep_link: "/bookings",
        },
      ],
    );
    const profile = qc.getQueryData<Record<string, unknown>>(["my-profile"]);
    if (profile)
      qc.setQueryData(["my-profile"], {
        ...profile,
        full_name: "عميل التجربة",
        avatar_url: null,
        phone: null,
      });

    for (const categorySlug of ["babysitting", "tutoring"]) {
      const services = provider.services.filter(
        (row) => row.service.category.slug === categorySlug,
      );
      qc.setQueryData(
        ["marketplace-services", categorySlug],
        services.map((row) => ({ ...row.service, category_slug: categorySlug })),
      );
      const row = {
        ...provider,
        is_top_pro: false,
        hourly_rate: services[0]?.price_override ?? provider.hourly_rate,
        services,
      };
      for (const limit of [20, 50, 60]) {
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
      previewBookings.map((booking) => ({
        ...booking,
        provider,
        service: { ...booking.service, name_ar: "جليسة أطفال بالساعة" },
      })),
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
