import type { QueryClient } from "@tanstack/react-query";
import { PREVIEW_NOW_ISO, PREVIEW_PROVIDER_ID, PREVIEW_USER_ID } from "@/lib/preview/constants";

/** Pro-only, synthetic fixtures. Never imported by production routes. */
export function seedProviderJourney(qc: QueryClient) {
  const provider = qc.getQueryData<any>(["my-provider"]);
  if (provider)
    qc.setQueryData(["my-provider"], {
      ...provider,
      name: "منى عادل",
      profile: { ...provider.profile, full_name: "منى عادل", avatar_url: null },
    });
  const rows = qc.getQueryData<any[]>(["provider-bookings", PREVIEW_PROVIDER_ID]) ?? [];
  const enriched = rows.map((row) => ({
    ...row,
    created_at: new Date(+new Date(PREVIEW_NOW_ISO) - 30 * 60_000).toISOString(),
    customer: { full_name: "سارة حسن", avatar_url: null, phone: null },
    service: { ...row.service, name_ar: "جليسة أطفال بالساعة", name_en: "Hourly babysitting" },
    location:
      row.status === "pending"
        ? null
        : { street: "شارع النخيل", building: "12", area: "الشيخ زايد" },
    party: {
      booking_id: row.id,
      viewer_role: "provider",
      other_user_id: "synthetic-customer",
      other_name: "سارة حسن",
      other_avatar_url: null,
      other_phone: null,
      area: "الشيخ زايد",
      zone_name_ar: "الشيخ زايد",
      zone_name_en: "Sheikh Zayed",
      member_first_name: "آدم",
      member_age_years: 5,
    },
    notes: null,
    requirement_choices: [],
  }));
  qc.setQueryData(["provider-bookings", PREVIEW_PROVIDER_ID], enriched);
  const stages = [
    "confirmed",
    "on_the_way",
    "arrived",
    "arrival_confirmed",
    "in_progress",
    "completion_requested",
    "completed",
  ];
  const journey = stages.map((status) => ({
    ...enriched[0],
    id: `journey-${status}`,
    status,
    start_at: new Date(+new Date(PREVIEW_NOW_ISO) - 60 * 60_000).toISOString(),
    end_at: new Date(+new Date(PREVIEW_NOW_ISO) + 2 * 60 * 60_000).toISOString(),
  }));
  for (const row of [...enriched, ...journey]) {
    qc.setQueryData(["provider-booking", row.id], row);
    qc.setQueryData(["booking-parties", [row.id]], new Map([[row.id, row.party]]));
    for (const key of [
      "booking-disputes",
      "booking-no-show-reports",
      "booking-support-tickets",
      "booking-reschedules",
    ])
      qc.setQueryData([key, row.id], []);
    const conv = `conv-${row.id}`;
    qc.setQueryData(
      ["conversation-by-booking", row.id, row.status === "pending" ? "pending" : "open"],
      row.status === "pending" ? null : conv,
    );
    qc.setQueryData(
      ["messages", conv],
      [
        {
          id: `message-${row.id}`,
          sender_id: "synthetic-customer",
          sender_role: "customer",
          message_type: "text",
          system_key: null,
          body: "أهلا يا منى، آدم مستنيكي. شكرا ليكي!",
          created_at: PREVIEW_NOW_ISO,
        },
      ],
    );
    if (row.id.startsWith("journey-"))
      qc.setQueryData(["payment", row.id], {
        id: `pay-${row.id}`,
        booking_id: row.id,
        status: row.status === "completed" ? "captured" : "pending",
        amount: row.price_total,
        payment_method_code: "cash",
        payment_method_name_ar: "كاش",
        payment_method_name_en: "Cash",
      });
  }
  qc.setQueryData(
    ["pro-notifications", PREVIEW_USER_ID],
    [
      {
        id: "journey-request",
        title_ar: "طلب حجز جديد",
        body_ar: "سارة حسن طلبت جليسة أطفال بكرة الساعة 2 م.",
        title_en: "New booking request",
        body_en: "Sara requested babysitting tomorrow at 2 PM.",
        created_at: PREVIEW_NOW_ISO,
        read_at: null,
        deep_link: "/pro/booking/booking-pro-pending-1",
      },
      {
        id: "journey-approved",
        title_ar: "طلبك اتوافق عليه",
        body_ar: "تقدري تستقبلي طلبات جديدة دلوقتي.",
        title_en: "Application approved",
        body_en: "You can receive new requests now.",
        created_at: PREVIEW_NOW_ISO,
        read_at: null,
        deep_link: "/pro",
      },
      {
        id: "journey-payment",
        title_ar: "الدفعة وصلت",
        body_ar: "اتدفع 540 جنيه عن الحجز اللي خلص.",
        title_en: "Payment received",
        body_en: "EGP 540 was paid for the completed booking.",
        created_at: "2026-08-31T10:00:00.000Z",
        read_at: PREVIEW_NOW_ISO,
        deep_link: "/pro/earnings",
      },
    ],
  );
}
