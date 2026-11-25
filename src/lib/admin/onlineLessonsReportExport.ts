import { downloadCsv } from "@/lib/admin/csvExport";
import type { AdminOnlineLessonsReport } from "@/lib/db/admin-online-lessons-queries";

export function downloadOnlineLessonsBookingsCsv(
  report: AdminOnlineLessonsReport,
  labels: Record<string, string>,
  filename: string,
) {
  const keys = [
    "booking_id",
    "start_at",
    "subject",
    "teacher_name",
    "student_phone_masked",
    "status",
    "price_total",
    "price_commission_amount",
    "price_provider_net",
    "payment_method",
  ] as const;
  const header = keys.map((k) => labels[k] ?? k);
  const rows = report.export_rows.map((row) => [
    row.booking_id,
    row.start_at,
    row.subject_en,
    row.teacher_name,
    row.student_phone_masked ?? "",
    row.status,
    row.price_total != null ? String(row.price_total) : "",
    row.price_commission_amount != null ? String(row.price_commission_amount) : "",
    row.price_provider_net != null ? String(row.price_provider_net) : "",
    row.payment_method ?? "",
  ]);
  downloadCsv(filename, [header, ...rows]);
}
