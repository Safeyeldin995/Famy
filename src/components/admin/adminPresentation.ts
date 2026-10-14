export function adminDate(value: string | null | undefined, language = "ar", withTime = true) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  const date = new Date(value);
  const locale = language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
  const options = { timeZone: "Africa/Cairo", numberingSystem: "latn" } as const;
  const day = new Intl.DateTimeFormat(locale, {
    ...options,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  if (!withTime) return day;
  const time = new Intl.DateTimeFormat(locale, {
    ...options,
    hour: "numeric",
    minute: date.getUTCMinutes() ? "2-digit" : undefined,
    hour12: true,
  }).format(date);
  return day + " · " + time;
}

const labels: Record<string, [string, string]> = {
  draft: ["مسودة", "Draft"],
  scheduled: ["مجدولة", "Scheduled"],
  sending: ["جاري الإرسال", "Sending"],
  sent: ["اتبعتت", "Sent"],
  cancelled: ["ملغية", "Cancelled"],
  failed: ["فشل", "Failed"],
  dead: ["الإرسال وقف", "Stopped"],
  pending: ["مستنية", "Pending"],
  customers: ["العملاء", "Customers"],
  providers: ["مقدمو الخدمة", "Providers"],
  all: ["الكل", "Everyone"],
  cash: ["كاش", "Cash"],
  manual_transfer: ["تحويل يدوي", "Manual transfer"],
  card: ["بطاقة", "Card"],
  babysitting: ["جليسة أطفال", "Babysitting"],
  tutoring: ["دروس خصوصية", "Tutoring"],
  submit: ["قدم الطلب", "Submitted application"],
  submitted: ["الطلب اتقدم", "Submitted"],
  start_review: ["بدأ مراجعة الطلب", "Started review"],
  under_review: ["تحت المراجعة", "Under review"],
  approve: ["وافق على الطلب", "Approved application"],
  approved: ["مقبول", "Approved"],
  reject: ["رفض الطلب", "Rejected application"],
  rejected: ["مرفوض", "Rejected"],
  request_changes: ["طلب تعديل", "Requested changes"],
  needs_changes: ["محتاج تعديل", "Needs changes"],
  request_updated_details: ["طلب تحديث البيانات", "Requested updated details"],
  suspend: ["أوقف الحساب", "Suspended account"],
  unsuspend: ["رجع الحساب", "Reactivated account"],
  suspended: ["موقوف", "Suspended"],
  online: ["دفع أونلاين", "Online payment"],
  instapay: ["إنستاباي", "InstaPay"],
  wallet: ["محفظة", "Wallet"],
};
export function adminLabel(value: string | null | undefined, language = "ar") {
  return (
    labels[String(value ?? "").toLowerCase()]?.[language.startsWith("ar") ? 0 : 1] ??
    // Unmapped codes stay visible so an admin can still tell them apart.
    (value ? String(value).replace(/_/g, " ") : "—")
  );
}
export function adminActor(value: string | null | undefined, language = "ar") {
  return !value || /^(admin|admin user)$/i.test(value.trim())
    ? language.startsWith("ar")
      ? "الإدارة"
      : "Administration"
    : value;
}
export function adminErrorSummary(value: string | null | undefined, language = "ar") {
  const message = value ?? "";
  const ar = language.startsWith("ar");
  if (/token.*(expired|invalid)|(expired|invalid).*token/i.test(message))
    return ar
      ? "الجهاز مش بيستقبل إشعارات (التوكن انتهى أو مش صالح)"
      : "Device cannot receive notifications (expired or invalid token)";
  if (/timeout|timed out/i.test(message))
    return ar ? "الخدمة اتأخرت في الرد" : "Service took too long to respond";
  if (/network|connection|fetch/i.test(message))
    return ar ? "في مشكلة في الاتصال بالخدمة" : "Connection to the service failed";
  return ar ? "حصلت مشكلة محتاجة مراجعة" : "A problem needs review";
}

export function adminRelativeAge(value: string, now: number, language: string) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
  if (!Number.isFinite(minutes)) return "—";
  const count =
    minutes >= 1440
      ? Math.floor(minutes / 1440)
      : minutes >= 60
        ? Math.floor(minutes / 60)
        : minutes;
  if (!language.startsWith("ar"))
    return count + (minutes >= 1440 ? " days" : minutes >= 60 ? " hours" : " minutes");
  if (minutes < 1) return "أقل من دقيقة";
  return count + (minutes >= 1440 ? " يوم" : minutes >= 60 ? " ساعة" : " دقيقة");
}
