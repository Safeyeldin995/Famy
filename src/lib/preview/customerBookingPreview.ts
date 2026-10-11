import type { QueryClient } from "@tanstack/react-query";
import { cairoWallTime } from "@/lib/pricing/servicePackages";
import type { TeachingCapabilityOption } from "@/lib/tutoring/teachingCapabilities";

export const bookingPreviewServices = [
  {
    id: "booking-hourly",
    name_ar: "جليسة أطفال بالساعة",
    name_en: "Hourly babysitting",
    pricing_model: "hourly",
    duration_min: 120,
    fixed_start_time: null,
    category: { slug: "babysitting" },
    rate: 250,
  },
  {
    id: "booking-day",
    name_ar: "يوم كامل",
    name_en: "Full day",
    pricing_model: "fixed",
    duration_min: 480,
    fixed_start_time: null,
    category: { slug: "babysitting" },
    rate: 1400,
  },
  {
    id: "booking-night",
    name_ar: "بالليل",
    name_en: "Overnight",
    pricing_model: "fixed",
    duration_min: 360,
    fixed_start_time: "18:00:00",
    category: { slug: "babysitting" },
    rate: 900,
  },
  {
    id: "booking-tutoring",
    name_ar: "دروس خصوصية",
    name_en: "Tutoring",
    pricing_model: "hourly",
    duration_min: 60,
    fixed_start_time: null,
    category: { slug: "tutoring" },
    rate: 450,
  },
];

export const bookingPreviewCapability: TeachingCapabilityOption = {
  id: "booking-math-60",
  providerId: "p1",
  serviceId: "booking-tutoring",
  curriculumId: "egypt",
  levelId: "grade-1",
  subjectCode: "math",
  subjectNameEn: "Math",
  subjectNameAr: "رياضيات",
  curriculumCode: "egypt",
  curriculumNameEn: "Egyptian",
  curriculumNameAr: "مصري",
  levelCode: "grade-1",
  levelNameEn: "Grade 1",
  levelNameAr: "الصف الأول",
  durationMin: 60,
  price: 450,
  status: "approved",
  maxSessionDurationMin: 120,
};

/** Exact live-hook query keys, local preview fixtures only. */
export function seedCustomerBookingPreview(qc: QueryClient, provider: Record<string, unknown>) {
  const services = bookingPreviewServices.map((service) => ({
    status: "approved",
    price_override: service.rate,
    service: { ...service, slug: service.id, is_active: true },
  }));
  const profile = {
    ...provider,
    profile: { full_name: "منى عادل", avatar_url: null },
    city: "الشيخ زايد",
    hourly_rate: 250,
    services,
  };
  qc.setQueryData(["provider-services", "p1"], services);
  for (const addressId of [undefined, "addr-1"])
    qc.setQueryData(["provider", "p1", addressId], profile);
  const members = [
    {
      id: "booking-child",
      full_name: "يوسف",
      relationship: "son",
      date_of_birth: "2020-05-12",
      is_active: true,
      education_curriculum_id: "egypt",
      education_level_id: "grade-1",
    },
  ];
  qc.setQueryData(["family-members", "active"], members);
  qc.setQueryData(["customer-education-profile"], null);
  for (const service of bookingPreviewServices) {
    qc.setQueryData(["service-requirements", service.id], []);
    qc.setQueryData(
      ["approved-teaching-capabilities", "p1", service.id],
      service.category.slug === "tutoring"
        ? [
            bookingPreviewCapability,
            { ...bookingPreviewCapability, id: "booking-math-90", durationMin: 90, price: 600 },
          ]
        : [],
    );
    for (const addressId of [null, "addr-1"]) {
      qc.setQueryData(["provider-booking-settings", "p1", service.id, addressId], {
        vacation_mode: false,
        min_notice_hours: 2,
        max_advance_days: 30,
        buffer_minutes: 30,
      });
      for (let index = 0; index < 14; index++) {
        const day = new Date();
        day.setHours(0, 0, 0, 0);
        day.setDate(day.getDate() + index);
        for (const minutes of [60, 90, 120, 240, 360, 480]) {
          const fixed = service.pricing_model === "fixed";
          const slots =
            index === 3
              ? []
              : (service.fixed_start_time ? [18] : [9, 10, 11, 13, 14])
                  .map((hour) => {
                    const start = fixed
                      ? cairoWallTime(day, `${hour}:00`)
                      : new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
                    return {
                      label: start.toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                        ...(fixed ? { timeZone: "Africa/Cairo" } : {}),
                      }),
                      start,
                      end: new Date(+start + minutes * 60000),
                    };
                  })
                  .filter((slot) => +slot.start > Date.now() + 2 * 3600000);
          qc.setQueryData(
            [
              "available-slots",
              "p1",
              day.toDateString(),
              minutes,
              service.id,
              addressId,
              fixed,
              service.fixed_start_time,
            ],
            slots,
          );
        }
      }
    }
  }
}
