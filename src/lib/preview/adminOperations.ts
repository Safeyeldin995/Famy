import type { QueryClient } from "@tanstack/react-query";
import { PREVIEW_NOW_ISO } from "./constants";
import { bookingStatuses, paymentStatuses } from "@/components/admin/operations";

// Synthetic preview only; never imported by an authenticated production query.
export function seedAdminOperations(qc: QueryClient) {
  const now = Date.parse(PREVIEW_NOW_ISO);
  const at = (hours: number) => new Date(now + hours * 3600000).toISOString();
  const bookings = ["confirmed", "disputed", "no_show", "completed"].map((status, index) => ({
    id: ["a1b2c3-preview", "b2c3d4-preview", "c3d4e5-preview", "d4e5f6-preview"][index],
    status,
    created_at: at(-48),
    start_at: at(index === 0 ? 48 : -5),
    price_total: 400,
    customer_id: "preview-customer",
    customer: { full_name: "عميلة تجريبية" },
    provider: { id: "p-pending", profile: { full_name: "مقدمة خدمة تجريبية" } },
    service: {
      name_ar: index % 2 ? "جليسة أطفال بالساعة" : "دروس رياضيات",
      name_en: index % 2 ? "Babysitting" : "Math tutoring",
    },
    payments: [],
    family_member: null,
  }));
  for (const status of ["all", ...bookingStatuses])
    qc.setQueryData(
      ["admin", "bookings", status],
      status === "all" ? bookings : bookings.filter((b) => b.status === status),
    );
  qc.setQueryData(
    ["admin", "bookings", ["disputed", "no_show"]],
    bookings.filter((b) => ["disputed", "no_show"].includes(b.status)),
  );
  for (const booking of bookings) {
    qc.setQueryData(
      ["admin", "booking-history", booking.id],
      [
        { id: `${booking.id}-1`, to_status: "pending", created_at: at(-48), reason: null },
        { id: `${booking.id}-2`, to_status: booking.status, created_at: at(-2), reason: null },
      ],
    );
    qc.setQueryData(["conversation-by-booking", booking.id, "open"], `conversation-${booking.id}`);
    qc.setQueryData(
      ["messages", `conversation-${booking.id}`],
      [
        {
          id: "message-preview",
          sender_role: "customer",
          message_type: "text",
          body: "محتاجة مساعدة بخصوص ميعاد الحجز",
          created_at: at(-2),
        },
      ],
    );
    qc.setQueryData(["reschedule-requests", booking.id], []);
  }
  qc.setQueryData(
    ["cancellation-reasons", "admin"],
    [
      {
        id: "reason-preview",
        name_ar: "طلب من العميل",
        name_en: "Customer request",
        is_active: true,
        actor_type: "admin",
        requires_note: true,
      },
    ],
  );
  const kinds = ["support-tickets", "disputes", "no-show-reports"];
  const texts = ["استفسار عن التحويل", "الخدمة ماكملتش زي الاتفاق", "مقدم الخدمة ماحضرش"];
  kinds.forEach((kind, index) =>
    qc.setQueryData(
      ["admin", kind, {}],
      [
        {
          id: `case-${index}`,
          status: "open",
          created_at: at(-(index + 1) * 2),
          booking_id: bookings[index].id,
          booking: bookings[index],
          subject: texts[index],
          reason: texts[index],
          description: texts[index],
          category: "booking_issue",
          opened_by_role: "customer",
          reporter_role: "customer",
          reported_party: "provider",
          previous_status: "confirmed",
          evidence_paths: [],
        },
      ],
    ),
  );
  const payments = [
    {
      id: "payment-preview-review",
      booking_id: bookings[3].id,
      booking: bookings[3],
      status: "pending_review",
      method: "instapay",
      payment_method_type: "manual_transfer",
      amount: 400,
      created_at: at(-1),
      proof_path: "preview/transfer-proof.png",
      previewProofUrl:
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="#fff5fa"/><text x="200" y="60" text-anchor="middle" font-size="22">صورة تحويل تجريبية</text><text x="200" y="110" text-anchor="middle" font-size="28">400 ج.م</text><text x="200" y="150" text-anchor="middle" font-size="16">مش إيصال دفع حقيقي</text></svg>',
        ),
    },
    {
      id: "payment-preview-captured",
      booking_id: bookings[0].id,
      booking: bookings[0],
      status: "captured",
      method: "cash",
      payment_method_type: "cash",
      amount: 400,
      created_at: at(-24),
      proof_path: null,
    },
  ];
  for (const status of ["all", ...paymentStatuses])
    qc.setQueryData(
      ["admin", "payments", status],
      status === "all" ? payments : payments.filter((p) => p.status === status),
    );
}
