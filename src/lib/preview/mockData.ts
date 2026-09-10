import { PREVIEW_NOW_ISO, PREVIEW_PROVIDER_ID, PREVIEW_USER_ID } from "@/lib/preview/constants";
import { addressesQueryKey, addressQueryKey, defaultAddressQueryKey } from "@/lib/db/address-query-keys";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const PREVIEW_NOW_MS = Date.parse(PREVIEW_NOW_ISO);

function previewIso(offsetMs = 0) {
  return new Date(PREVIEW_NOW_MS + offsetMs).toISOString();
}

function previewUtc(daysOffset: number, hour: number, minute = 0) {
  const d = new Date(PREVIEW_NOW_MS + daysOffset * DAY_MS);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

const cat = (slug: string, en: string, ar: string, order: number) => ({
  id: slug,
  slug,
  name_en: en,
  name_ar: ar,
  description_en: `${en} by verified Famy professionals.`,
  description_ar: `${ar} من محترفين Famy موثوقين.`,
  is_active: true,
  sort_order: order,
});

const providerRow = (
  id: string,
  name: string,
  rate: number,
  avg: number,
  count: number,
  slug: string,
  avatar: string,
) => ({
  id,
  bio_en: `Experienced ${slug.replace("-", " ")} professional serving Cairo families.`,
  bio_ar: "محترفة موثوقة تخدم العائلات في القاهرة.",
  hourly_rate: rate,
  years_experience: 5,
  languages: ["ar", "en"],
  city: "Cairo",
  is_top_pro: true,
  is_verified: true,
  response_time_min: 5,
  profile: { full_name: name, avatar_url: avatar },
  ratings: { rating_avg: avg, rating_count: count },
  trust: { score: 92 },
  services: [
    {
      status: "approved",
      service: {
        id: `${id}-s`,
        slug,
        name_en: slug.replace("-", " "),
        name_ar: slug,
        category: { slug },
      },
    },
  ],
});

const p1 = providerRow("p1", "Mona Adel", 180, 4.9, 128, "home-cleaning", "https://i.pravatar.cc/240?img=47");
const p2 = providerRow("p2", "Nour Ibrahim", 220, 4.8, 96, "babysitting", "https://i.pravatar.cc/240?img=32");
const p3 = providerRow("p3", "Hala Mostafa", 200, 4.9, 74, "cooking", "https://i.pravatar.cc/240?img=45");

const start = previewUtc(2, 10);
const end = previewUtc(2, 13);

export const previewAddresses = [
  {
    id: "addr-1",
    user_id: PREVIEW_USER_ID,
    label: "home",
    custom_label: null,
    city: "Giza",
    area: "Maadi",
    street: "Road 9",
    building: "12",
    compound: "Degla",
    apartment: "4B",
    is_default: true,
    lat: 29.96,
    lng: 31.25,
    access_notes: null,
    floor: null,
    landmark: null,
    line1: "Road 9",
    line2: "Degla · 12",
  },
];

export const previewBookings = [
  {
    id: "booking-preview-1",
    provider_id: "p1",
    customer_id: PREVIEW_USER_ID,
    status: "confirmed",
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    price_total: 540,
    service: { name_en: "Deep home clean", name_ar: "تنظيف منزل عميق" },
    provider: p1,
  },
  {
    id: "booking-preview-2",
    provider_id: "p2",
    customer_id: PREVIEW_USER_ID,
    status: "completed",
    start_at: previewIso(-DAY_MS * 5),
    end_at: previewIso(-DAY_MS * 5 + 2 * HOUR_MS),
    price_total: 440,
    service: { name_en: "Babysitting", name_ar: "جليسة أطفال" },
    provider: p2,
  },
];

export const previewConversations = [
  {
    id: "conv-1",
    booking_id: "booking-preview-1",
    customer_id: PREVIEW_USER_ID,
    provider_user_id: "provider-user-1",
    updated_at: previewIso(),
    other_name: "Mona Adel",
    other_avatar: "https://i.pravatar.cc/240?img=47",
    last_message: "I'll arrive 10 minutes early to set up.",
    last_time: previewIso(),
  },
];

export const previewMessages = [
  {
    id: "m1",
    conversation_id: "conv-1",
    sender_id: "provider-user-1",
    body: "Hi Sara! Looking forward to your booking tomorrow.",
    created_at: previewIso(-HOUR_MS),
  },
  {
    id: "m2",
    conversation_id: "conv-1",
    sender_id: PREVIEW_USER_ID,
    body: "Great, please ring the intercom when you arrive.",
    created_at: previewIso(-HOUR_MS + 10 * 60_000),
  },
  {
    id: "m3",
    conversation_id: "conv-1",
    sender_id: "provider-user-1",
    body: "I'll arrive 10 minutes early to set up.",
    created_at: previewIso(),
  },
];

function buildPreviewSlots(dayOffset: number, slotMinutes: number) {
  const now = new Date(PREVIEW_NOW_MS);
  const minNoticeMs = 2 * HOUR_MS;
  const starts = [9, 10, 11, 13, 14, 15];
  const slots: { label: string; start: Date; end: Date }[] = [];

  for (const hour of starts) {
    const start = previewUtc(dayOffset, hour);
    const end = new Date(+start + slotMinutes * 60_000);
    if (end.getUTCHours() > 18 || (end.getUTCHours() === 18 && end.getUTCMinutes() > 0)) continue;
    if (start.getTime() < now.getTime() + minNoticeMs) continue;
    slots.push({
      label: start.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }),
      start: new Date(start),
      end,
    });
  }

  return slots;
}

function seedPreviewAvailableSlots(qc: import("@tanstack/react-query").QueryClient) {
  const providerId = "p1";
  const slotDurations = [120, 240, 360, 480];
  const serviceIds: Array<string | null> = [null, "svc-clean"];
  const addressIds: Array<string | null> = [null, "addr-1"];

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const day = previewUtc(dayOffset, 0, 0);
    const dateKey = day.toDateString();

    for (const slotMinutes of slotDurations) {
      const slots = buildPreviewSlots(dayOffset, slotMinutes);
      for (const serviceId of serviceIds) {
        for (const addressId of addressIds) {
          qc.setQueryData(
            ["available-slots", providerId, dateKey, slotMinutes, serviceId, addressId],
            slots,
          );
        }
      }
    }
  }
}

export function seedPreviewQueries(qc: import("@tanstack/react-query").QueryClient) {
  const profile = { id: PREVIEW_USER_ID, full_name: "Sara Hassan", phone: "+201012345678", avatar_url: null };

  qc.setQueryData(["my-profile"], profile);
  qc.setQueryData(defaultAddressQueryKey(PREVIEW_USER_ID), previewAddresses[0]);
  qc.setQueryData(addressesQueryKey(PREVIEW_USER_ID), previewAddresses);
  qc.setQueryData(addressQueryKey(PREVIEW_USER_ID, previewAddresses[0].id), previewAddresses[0]);
  qc.setQueryData(["notifications", "unread-count"], 2);
  qc.setQueryData(["my-bookings"], previewBookings);
  qc.setQueryData(["categories"], [
    cat("home-cleaning", "Home cleaning", "تنظيف المنزل", 1),
    cat("babysitting", "Babysitting", "جليسة أطفال", 2),
    cat("elderly-care", "Elderly care", "رعاية كبار السن", 3),
    cat("cooking", "Home cooking", "طبخ منزلي", 4),
    cat("tutoring", "Tutoring", "دروس خصوصية", 5),
  ]);
  qc.setQueryData(["providers", { limit: 20 }], [p1, p2, p3]);
  qc.setQueryData(["providers", { categorySlug: "home-cleaning", serviceId: "svc-clean", limit: 50 }], [p1]);
  qc.setQueryData(["providers", { categorySlug: "home-cleaning", serviceId: undefined, limit: 50 }], [p1]);
  qc.setQueryData(["providers", { serviceId: undefined, addressId: undefined, limit: 60 }], [p1, p2, p3]);
  for (const provider of [p1, p2, p3]) {
    qc.setQueryData(["provider", provider.id, undefined], provider);
    qc.setQueryData(["provider", provider.id, previewAddresses[0].id], provider);
  }
  qc.setQueryData(["reviews", "p1"], [
    {
      id: "rev-1",
      rating: 5,
      comment: "Mona was punctual, thorough, and so kind with our home.",
      author_name: "Sara M.",
      author_avatar: "https://i.pravatar.cc/240?img=12",
      created_at: previewIso(-DAY_MS * 12),
    },
    {
      id: "rev-2",
      rating: 5,
      comment: "Booked twice — both visits were excellent.",
      author_name: "Nadia K.",
      author_avatar: "https://i.pravatar.cc/240?img=25",
      created_at: previewIso(-DAY_MS * 28),
    },
  ]);
  qc.setQueryData(["provider-availability", "p1"], [
    { weekday: 1, start_time: "09:00", end_time: "18:00" },
    { weekday: 2, start_time: "09:00", end_time: "18:00" },
    { weekday: 3, start_time: "09:00", end_time: "18:00" },
    { weekday: 4, start_time: "09:00", end_time: "18:00" },
    { weekday: 5, start_time: "09:00", end_time: "16:00" },
    { weekday: 6, start_time: "10:00", end_time: "14:00" },
  ]);
  qc.setQueryData(["provider-availability", "p2"], [
    { weekday: 0, start_time: "08:00", end_time: "20:00" },
    { weekday: 1, start_time: "08:00", end_time: "20:00" },
    { weekday: 2, start_time: "08:00", end_time: "20:00" },
    { weekday: 3, start_time: "08:00", end_time: "20:00" },
    { weekday: 4, start_time: "08:00", end_time: "20:00" },
  ]);
  qc.setQueryData(["provider-availability", "p3"], [
    { weekday: 1, start_time: "11:00", end_time: "19:00" },
    { weekday: 3, start_time: "11:00", end_time: "19:00" },
    { weekday: 5, start_time: "11:00", end_time: "19:00" },
    { weekday: 6, start_time: "11:00", end_time: "19:00" },
  ]);
  qc.setQueryData(["favorite-ids"], []);
  qc.setQueryData(["favorites"], [{ provider_id: "p1", provider: p1 }]);
  qc.setQueryData(["featured-promo-codes"], [
    {
      id: "promo1",
      code: "FAMY20",
      description_en: "20% off your first booking with Famy",
      description_ar: "خصم ٢٠٪ على أول حجز",
      discount_type: "percentage",
      discount_value: 20,
      minimum_booking_amount: 0,
      expires_at: null,
    },
    {
      id: "promo2",
      code: "WEEKEND15",
      description_en: "Book Saturday or Sunday and save",
      description_ar: "احجز السبت أو الأحد ووفر",
      discount_type: "percentage",
      discount_value: 15,
      minimum_booking_amount: 0,
      expires_at: null,
    },
  ]);
  qc.setQueryData(["my-promo-redemptions"], []);
  qc.setQueryData(["conversations"], previewConversations);
  qc.setQueryData(["conversation", "conv-1"], {
    id: "conv-1",
    other: { full_name: "Mona Adel", avatar_url: "https://i.pravatar.cc/240?img=47" },
  });
  qc.setQueryData(["messages", "conv-1"], previewMessages);
  qc.setQueryData(["marketplace-services", "all"], [
    { id: "svc-clean", name_en: "Deep clean", name_ar: "تنظيف عميق", category_slug: "home-cleaning" },
    { id: "svc-kids", name_en: "Babysitting", name_ar: "جليسة أطفال", category_slug: "babysitting" },
  ]);
  qc.setQueryData(["marketplace-services", "home-cleaning"], [
    { id: "svc-clean", name_en: "Deep clean", name_ar: "تنظيف عميق", category_slug: "home-cleaning" },
  ]);
  qc.setQueryData(["notifications"], [
    {
      id: "n1",
      title_en: "Booking confirmed",
      body_en: "Mona will visit on Thursday at 10:00 AM.",
      title_ar: "تم تأكيد الحجز",
      body_ar: "ستزورك منى يوم الخميس الساعة ١٠ صباحاً.",
      read_at: null,
      category: "booking",
      created_at: previewIso(),
      deep_link: "/bookings",
    },
    {
      id: "n2",
      title_en: "20% off your first booking",
      body_en: "Use code FAMY20 before it expires.",
      title_ar: "خصم ٢٠٪",
      body_ar: "استخدمي الكود FAMY20",
      read_at: previewIso(),
      category: "campaign",
      created_at: previewIso(-DAY_MS),
      deep_link: null,
    },
  ]);
  qc.setQueryData(["family-members"], [
    {
      id: "fm-1",
      full_name: "Omar Hassan",
      relationship: "child",
      relationship_other: null,
      date_of_birth: "2019-05-12",
      is_active: true,
    },
  ]);
  qc.setQueryData(["avatar-url", "https://i.pravatar.cc/240?img=47"], "https://i.pravatar.cc/240?img=47");
  qc.setQueryData(["avatar-url", "https://i.pravatar.cc/240?img=32"], "https://i.pravatar.cc/240?img=32");
  qc.setQueryData(["avatar-url", "https://i.pravatar.cc/240?img=45"], "https://i.pravatar.cc/240?img=45");
  qc.setQueryData(["support-contact"], { phone: "+201000000000", whatsapp: "+201000000000", note: "Preview" });
  qc.setQueryData(["settings", "billing"], { vat_percent: 14, platform_fee: 25 });
  qc.setQueryData(["settings", "service_areas"], [
    { name: "Maadi", enabled: true },
    { name: "Sheikh Zayed", enabled: true },
    { name: "6th of October", enabled: true },
  ]);
  qc.setQueryData(["provider-services", "p1"], [
    {
      price_override: null,
      status: "approved",
      service: {
        id: "svc-clean",
        slug: "home-cleaning",
        name_en: "Deep home clean",
        name_ar: "تنظيف منزل عميق",
        is_active: true,
        category: { slug: "home-cleaning", name_en: "Home cleaning", name_ar: "تنظيف المنزل" },
      },
    },
  ]);
  qc.setQueryData(["provider-booking-settings", "p1", null, "addr-1"], {
    vacation_mode: false,
    min_notice_hours: 2,
    max_advance_days: 30,
    buffer_minutes: 30,
  });
  qc.setQueryData(["provider-booking-settings", "p1", "svc-clean", "addr-1"], {
    vacation_mode: false,
    min_notice_hours: 2,
    max_advance_days: 30,
    buffer_minutes: 30,
  });
  seedPreviewAvailableSlots(qc);
  seedPreviewProviderQueries(qc);
  seedPreviewAdminQueries(qc);
  qc.setQueryData(["resolve-zone", 29.96, 31.25], {
    id: "zone-maadi",
    name_en: "Maadi",
    name_ar: "المعادي",
    travel_fee: 0,
  });
  qc.setQueryData(["payment-methods", "active"], [
    {
      id: "pm-cash",
      code: "cash",
      name_en: "Cash on arrival",
      name_ar: "نقداً عند الوصول",
      instructions_en: null,
      instructions_ar: null,
      method_type: "cash",
      is_active: true,
      is_default: true,
      display_order: 1,
      public_config: {},
      created_at: previewIso(),
      updated_at: previewIso(),
    },
  ]);
}

const previewCustomer = {
  full_name: "Sara Hassan",
  avatar_url: "https://i.pravatar.cc/240?img=12",
  phone: "+201012345678",
};

const previewBookingLocation = {
  street: "Road 9",
  building: "12",
  compound: "Degla",
  city: "Giza",
  area: "Maadi",
};

const previewService = {
  id: "svc-clean",
  slug: "home-cleaning",
  name_en: "Deep home clean",
  name_ar: "تنظيف منزل عميق",
};

function buildPreviewProviderBookings() {
  const pendingStart = previewUtc(1, 14);
  const pendingEnd = previewUtc(1, 17);
  const confirmedStart = previewUtc(3, 10);
  const confirmedEnd = previewUtc(3, 14);
  const completedStart = previewUtc(-4, 11);
  const completedEnd = previewUtc(-4, 14);

  const base = {
    provider_id: PREVIEW_PROVIDER_ID,
    customer_id: PREVIEW_USER_ID,
    service: previewService,
    customer: previewCustomer,
    location: previewBookingLocation,
  };

  return [
    {
      ...base,
      id: "booking-pro-pending-1",
      status: "pending",
      start_at: pendingStart.toISOString(),
      end_at: pendingEnd.toISOString(),
      price_total: 540,
      total_price: 540,
    },
    {
      ...base,
      id: "booking-pro-confirmed-1",
      status: "confirmed",
      start_at: confirmedStart.toISOString(),
      end_at: confirmedEnd.toISOString(),
      price_total: 720,
      total_price: 720,
    },
    {
      ...base,
      id: "booking-pro-completed-1",
      status: "completed",
      start_at: completedStart.toISOString(),
      end_at: completedEnd.toISOString(),
      price_total: 540,
      total_price: 540,
    },
  ];
}

function seedPreviewProviderQueries(qc: import("@tanstack/react-query").QueryClient) {
  const previewProviderBookings = buildPreviewProviderBookings();
  const myProvider = {
    id: PREVIEW_PROVIDER_ID,
    profile_id: PREVIEW_USER_ID,
    name: "Mona Adel",
    bio_en: p1.bio_en,
    bio_ar: p1.bio_ar,
    years_experience: 5,
    hourly_rate: 180,
    city: "Cairo",
    country: "EG",
    languages: ["ar", "en"],
    is_active: true,
    is_verified: true,
    is_top_pro: true,
    vacation_mode: false,
    onboarding_status: "APPROVED",
    submitted_at: previewIso(-DAY_MS * 30),
    review_reason_public: null,
    review_reason_code: null,
    created_at: previewIso(-DAY_MS * 90),
    profile: {
      id: PREVIEW_USER_ID,
      full_name: "Mona Adel",
      avatar_url: "https://i.pravatar.cc/240?img=47",
      phone: "+201098765432",
    },
    ratings: [{ rating_avg: 4.9, rating_count: 128 }],
    trust: [{ score: 92 }],
  };

  qc.setQueryData(["my-role"], "provider");
  qc.setQueryData(["my-provider"], myProvider);
  qc.setQueryData(["provider-bookings", PREVIEW_PROVIDER_ID], previewProviderBookings);
  qc.setQueryData(["provider-earnings", PREVIEW_PROVIDER_ID], {
    total: 12480,
    mtd: 3240,
    last7: 1860,
    completedCount: 41,
    upcomingPipeline: 1260,
  });
  qc.setQueryData(["provider-vacations", PREVIEW_PROVIDER_ID], []);
  qc.setQueryData(["provider-exceptions", PREVIEW_PROVIDER_ID], []);
  qc.setQueryData(["provider-documents", PREVIEW_PROVIDER_ID], [
    {
      id: "doc-1",
      provider_id: PREVIEW_PROVIDER_ID,
      document_type: "national_id",
      status: "approved",
      created_at: previewIso(-DAY_MS * 20),
    },
  ]);
  qc.setQueryData(["provider-marketplace-eligibility", PREVIEW_PROVIDER_ID], [
    {
      service_id: "svc-clean",
      service_name_en: "Deep home clean",
      service_name_ar: "تنظيف منزل عميق",
      is_eligible: true,
      failure_reasons: [],
    },
    {
      service_id: "svc-kids",
      service_name_en: "Babysitting",
      service_name_ar: "جليسة أطفال",
      is_eligible: false,
      failure_reasons: ["Complete babysitting requirements in profile"],
    },
  ]);
  qc.setQueryData(["my-provider-services", PREVIEW_PROVIDER_ID], [
    {
      service_id: "svc-clean",
      price_override: null,
      status: "approved",
      service: {
        id: "svc-clean",
        slug: "home-cleaning",
        name_en: "Deep home clean",
        name_ar: "تنظيف منزل عميق",
        is_active: true,
        provider_pricing_allowed: true,
        minimum_price: 120,
        maximum_price: 600,
        category: { name_en: "Home cleaning", name_ar: "تنظيف المنزل" },
      },
    },
  ]);
  qc.setQueryData(["my-requirement-fulfillments", PREVIEW_PROVIDER_ID], []);
  qc.setQueryData(["service-requirements", "svc-clean"], []);
  qc.setQueryData(["all-services"], [
    {
      id: "svc-clean",
      slug: "home-cleaning",
      name_en: "Deep home clean",
      name_ar: "تنظيف منزل عميق",
      is_active: true,
      category: { slug: "home-cleaning", name_en: "Home cleaning", name_ar: "تنظيف المنزل" },
    },
    {
      id: "svc-kids",
      slug: "babysitting",
      name_en: "Babysitting",
      name_ar: "جليسة أطفال",
      is_active: true,
      category: { slug: "babysitting", name_en: "Babysitting", name_ar: "جليسة أطفال" },
    },
  ]);
  qc.setQueryData(["provider-onboarding-snapshot"], {
    exists: true,
    profile: myProvider.profile,
    provider: { onboarding_status: "DRAFT" },
    details: {
      date_of_birth: "1990-04-18",
      gender: "female",
      governorate: "Cairo",
      area: "Maadi",
      full_address: "Road 9, Degla, Giza",
    },
    completion: { ok: true, complete: true, errors: {} },
  });
  qc.setQueryData(["provider-onboarding-completion", PREVIEW_PROVIDER_ID], {
    ok: true,
    complete: true,
    errors: {},
  });
  qc.setQueryData(["phase1-services"], [
    {
      id: "svc-clean",
      slug: "home-cleaning",
      name_en: "Deep home clean",
      name_ar: "تنظيف منزل عميق",
      category: { slug: "home-cleaning", name_en: "Home cleaning", name_ar: "تنظيف المنزل" },
    },
  ]);
  qc.setQueryData(["active-zones"], [
    { id: "zone-maadi", name_en: "Maadi", name_ar: "المعادي" },
    { id: "zone-zayed", name_en: "Sheikh Zayed", name_ar: "الشيخ زايد" },
  ]);
  qc.setQueryData(["pro-notifications", PREVIEW_USER_ID], [
    {
      id: "pn1",
      title_en: "New booking request",
      body_en: "Sara Hassan requested a deep home clean for tomorrow at 2:00 PM.",
      title_ar: "طلب حجز جديد",
      body_ar: "سارة حسن طلبت تنظيف منزل عميق غداً الساعة ٢ مساءً.",
      read_at: null,
      category: "booking",
      created_at: previewIso(),
      deep_link: "/pro/bookings",
    },
    {
      id: "pn2",
      title_en: "Payment received",
      body_en: "EGP 540 was captured for your completed visit.",
      title_ar: "تم استلام الدفع",
      body_ar: "تم استلام ٥٤٠ جنيه عن الزيارة المكتملة.",
      read_at: previewIso(-DAY_MS),
      category: "payment",
      created_at: previewIso(-DAY_MS),
      deep_link: "/pro/earnings",
    },
  ]);
  qc.setQueryData(["pro-notifications", "unread-count", PREVIEW_USER_ID], 1);
  qc.setQueryData(["provider-references", PREVIEW_PROVIDER_ID], [
    {
      id: "ref-1",
      provider_id: PREVIEW_PROVIDER_ID,
      full_name: "Nadia Kamal",
      relationship: "former_client",
      phone: "+201011122233",
      notes: "Regular weekly clean for 6 months",
      sort_order: 1,
    },
  ]);

  const previewBookingMessages = [
    {
      id: "pm-1",
      conversation_id: "conv-pro-pending",
      sender_id: PREVIEW_USER_ID,
      sender_role: "customer",
      message_type: "text",
      system_key: null,
      body: "Hi Mona! Please bring eco-friendly products if possible.",
      created_at: previewIso(-HOUR_MS),
    },
    {
      id: "pm-2",
      conversation_id: "conv-pro-pending",
      sender_id: PREVIEW_USER_ID,
      sender_role: "provider",
      message_type: "text",
      system_key: null,
      body: "Of course — I always use gentle, family-safe supplies.",
      created_at: previewIso(-HOUR_MS + 10 * 60_000),
    },
  ];

  for (const booking of previewProviderBookings) {
    const enriched = {
      ...booking,
      price_subtotal: booking.price_total,
      price_discount: 0,
      notes: booking.status === "pending" ? "Please ring the intercom — apartment 4B." : null,
      requirement_choices: [],
    };
    qc.setQueryData(["provider-booking", booking.id], enriched);
    qc.setQueryData(["booking-disputes", booking.id], []);
    qc.setQueryData(["booking-no-show-reports", booking.id], []);
    qc.setQueryData(["booking-support-tickets", booking.id], []);
    qc.setQueryData(["payment", booking.id], {
      id: `pay-${booking.id}`,
      booking_id: booking.id,
      status: booking.status === "completed" ? "captured" : "pending",
      amount: booking.price_total,
      method: "cash",
      payment_method_code: "cash",
      payment_method_name_en: "Cash on arrival",
      payment_method_name_ar: "نقداً عند الوصول",
      captured_at: booking.status === "completed" ? booking.end_at : null,
      created_at: booking.start_at,
      updated_at: booking.start_at,
    });
    if (booking.status === "pending") {
      qc.setQueryData(["conversation-by-booking", booking.id], "conv-pro-pending");
      qc.setQueryData(["messages", "conv-pro-pending"], previewBookingMessages);
    }
  }
}

const PREVIEW_ADMIN_PROVIDER_PENDING = "p-pending";

function buildAdminPreviewProviders() {
  const verified = {
    id: PREVIEW_PROVIDER_ID,
    city: "Cairo",
    hourly_rate: 180,
    years_experience: 5,
    is_verified: true,
    is_active: true,
    created_at: previewIso(-DAY_MS * 90),
    profile: { full_name: "Mona Adel", phone: "+201098765432", avatar_url: "https://i.pravatar.cc/240?img=47" },
    ratings: { rating_avg: 4.9, rating_count: 128 },
    trust: { score: 92 },
  };
  const pending = {
    id: PREVIEW_ADMIN_PROVIDER_PENDING,
    city: "Giza",
    hourly_rate: 150,
    years_experience: 3,
    is_verified: false,
    is_active: false,
    created_at: previewIso(-DAY_MS * 3),
    profile: { full_name: "Nadia Kamal", phone: "+201055544433", avatar_url: "https://i.pravatar.cc/240?img=32" },
    ratings: { rating_avg: 0, rating_count: 0 },
    trust: { score: 0 },
  };
  const suspended = {
    id: "p-suspended",
    city: "Alexandria",
    hourly_rate: 200,
    years_experience: 8,
    is_verified: true,
    is_active: false,
    created_at: previewIso(-DAY_MS * 120),
    profile: { full_name: "Layla Farouk", phone: "+201066677788", avatar_url: "https://i.pravatar.cc/240?img=45" },
    ratings: { rating_avg: 4.2, rating_count: 34 },
    trust: { score: 71 },
  };
  return [verified, pending, suspended];
}

function buildAdminPreviewBookings() {
  const start = previewUtc(2, 10);
  const end = previewUtc(2, 14);
  return [
    {
      id: "admin-booking-1",
      status: "confirmed",
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      price_total: 720,
      customer_id: PREVIEW_USER_ID,
      provider_id: PREVIEW_PROVIDER_ID,
      created_at: previewIso(-DAY_MS),
      customer: { id: PREVIEW_USER_ID, full_name: "Sara Hassan", phone: "+201012345678" },
      provider: { id: PREVIEW_PROVIDER_ID, profile: { full_name: "Mona Adel" } },
      payments: [{ id: "pay-1", status: "captured", method: "cash", amount: 720, created_at: start.toISOString() }],
      family_member: null,
      cancellation: null,
    },
    {
      id: "admin-booking-2",
      status: "pending",
      start_at: previewIso(DAY_MS),
      end_at: previewIso(DAY_MS + 3 * HOUR_MS),
      price_total: 540,
      customer_id: PREVIEW_USER_ID,
      provider_id: PREVIEW_PROVIDER_ID,
      created_at: previewIso(),
      customer: { id: PREVIEW_USER_ID, full_name: "Sara Hassan", phone: "+201012345678" },
      provider: { id: PREVIEW_PROVIDER_ID, profile: { full_name: "Mona Adel" } },
      payments: [{ id: "pay-2", status: "pending", method: "cash", amount: 540, created_at: previewIso() }],
      family_member: null,
      cancellation: null,
    },
  ];
}

export function seedPreviewAdminQueries(qc: import("@tanstack/react-query").QueryClient) {
  const providers = buildAdminPreviewProviders();
  const bookings = buildAdminPreviewBookings();
  const now = previewIso();
  const categories = [
    {
      id: "cat-clean",
      slug: "home-cleaning",
      name_en: "Home cleaning",
      name_ar: "تنظيف المنزل",
      is_active: true,
      sort_order: 1,
    },
    {
      id: "cat-kids",
      slug: "babysitting",
      name_en: "Babysitting",
      name_ar: "جليسة أطفال",
      is_active: true,
      sort_order: 2,
    },
  ];
  const services = [
    {
      id: "svc-clean",
      category_id: "cat-clean",
      slug: "home-cleaning",
      name_en: "Deep home clean",
      name_ar: "تنظيف منزل عميق",
      description_en: "Full home deep clean",
      description_ar: "تنظيف منزل عميق",
      base_price: 180,
      duration_min: 240,
      pricing_model: "hourly" as const,
      is_active: true,
      minimum_price: 120,
      maximum_price: 600,
      maximum_extras_total: 200,
      provider_pricing_allowed: true,
      created_at: now,
      updated_at: now,
      category: categories[0],
    },
  ];
  const customers = [
    {
      id: PREVIEW_USER_ID,
      full_name: "Sara Hassan",
      phone: "+201012345678",
      avatar_url: null,
      is_suspended: false,
      created_at: previewIso(-DAY_MS * 60),
      totalBookings: 3,
      completedBookings: 2,
      cancelledBookings: 0,
      totalSpent: 1260,
    },
    {
      id: "cust-2",
      full_name: "Omar Hassan",
      phone: "+201099988877",
      avatar_url: null,
      is_suspended: false,
      created_at: previewIso(-DAY_MS * 10),
      totalBookings: 0,
      completedBookings: 0,
      cancelledBookings: 0,
      totalSpent: 0,
    },
  ];

  qc.setQueryData(["admin", "dashboard-kpis"], {
    revenue: 24800,
    activeBookings: 12,
    pendingBookings: 4,
    activeProviders: 28,
    activeCustomers: 156,
  });
  qc.setQueryData(["admin", "bookings-count"], 47);
  qc.setQueryData(["admin", "pending-providers"], [providers[1]]);
  for (const filter of ["pending", "verified", "suspended", "all"] as const) {
    let rows = providers;
    if (filter === "pending") rows = providers.filter((p) => !p.is_verified);
    else if (filter === "verified") rows = providers.filter((p) => p.is_verified && p.is_active);
    else if (filter === "suspended") rows = providers.filter((p) => p.is_verified && !p.is_active);
    qc.setQueryData(["admin", "providers", filter], rows);
  }
  qc.setQueryData(["admin", "provider", PREVIEW_PROVIDER_ID], {
    ...providers[0],
    documents: [{ id: "doc-1", document_type: "national_id", status: "approved" }],
    services: [
      {
        id: "ps-1",
        status: "approved",
        rejection_reason: null,
        service: {
          id: "svc-clean",
          name_en: "Deep home clean",
          name_ar: "تنظيف منزل عميق",
          category: { name_en: "Home cleaning", name_ar: "تنظيف المنزل" },
        },
      },
    ],
  });
  qc.setQueryData(["admin", "provider", PREVIEW_ADMIN_PROVIDER_PENDING], {
    ...providers[1],
    documents: [{ id: "doc-2", document_type: "national_id", status: "pending" }],
    services: [],
  });
  qc.setQueryData(["admin", "provider-eligibility", PREVIEW_PROVIDER_ID], [
    {
      provider_id: PREVIEW_PROVIDER_ID,
      service_id: "svc-clean",
      service_name_en: "Deep home clean",
      service_name_ar: "تنظيف منزل عميق",
      identity_valid: true,
      account_active: true,
      verified: true,
      service_approved: true,
      service_active: true,
      effective_price: 180,
      minimum_price: 120,
      maximum_price: 600,
      price_valid: true,
      requirements_complete: true,
      evidence_approved: true,
      zone_covered: true,
      address_covered: true,
      availability_valid: true,
      operational_clear: true,
      is_eligible: true,
      failure_reasons: [],
    },
  ]);
  qc.setQueryData(["admin", "provider-onboarding-review", PREVIEW_ADMIN_PROVIDER_PENDING], {
    status: "SUBMITTED",
    submitted_at: previewIso(-DAY_MS),
  });
  qc.setQueryData(["admin", "identity-conflicts"], []);
  qc.setQueryData(["admin", "customers"], customers);
  qc.setQueryData(["admin", "customer", PREVIEW_USER_ID], {
    profile: customers[0],
    bookings: bookings.map((b) => ({
      id: b.id,
      status: b.status,
      start_at: b.start_at,
      price_total: b.price_total,
    })),
    payments: bookings.flatMap((b) => b.payments),
  });
  for (const status of ["all", "confirmed", "pending", "completed", "cancelled"]) {
    const rows =
      status === "all" ? bookings : bookings.filter((b) => b.status === status);
    qc.setQueryData(["admin", "bookings", status], rows);
  }
  qc.setQueryData(["admin", "payments", "all"], [
    {
      id: "pay-1",
      status: "captured",
      method: "cash",
      amount: 720,
      created_at: now,
      booking: {
        id: "admin-booking-1",
        status: "confirmed",
        provider: { id: PREVIEW_PROVIDER_ID, profile: { full_name: "Mona Adel" } },
        customer: { id: PREVIEW_USER_ID, full_name: "Sara Hassan", phone: "+201012345678" },
      },
    },
  ]);
  qc.setQueryData(["admin", "categories"], categories);
  qc.setQueryData(["admin", "services"], services);
  qc.setQueryData(["admin", "zones"], [
    {
      id: "zone-maadi",
      name_en: "Maadi",
      name_ar: "المعادي",
      travel_fee: 0,
      is_active: true,
      boundary_type: "circle",
      center_lat: 29.96,
      center_lng: 31.25,
      radius_km: 5,
      polygon: null,
    },
  ]);
  qc.setQueryData(["admin", "zone-services", "zone-maadi"], new Set(["svc-clean"]));
  qc.setQueryData(["admin", "zone-providers", "zone-maadi"], new Set([PREVIEW_PROVIDER_ID]));
  qc.setQueryData(["admin", "promo-codes"], [
    {
      id: "promo1",
      code: "FAMY20",
      description_en: "20% off first booking",
      description_ar: "خصم ٢٠٪ على أول حجز",
      discount_type: "percentage",
      discount_value: 20,
      is_active: true,
      expires_at: null,
      created_at: now,
    },
  ]);
  qc.setQueryData(["admin", "payment-methods"], [
    {
      id: "pm-cash",
      code: "cash",
      name_en: "Cash on arrival",
      name_ar: "نقداً عند الوصول",
      method_type: "cash",
      is_active: true,
      is_default: true,
      display_order: 1,
      public_config: {},
      created_at: now,
      updated_at: now,
    },
  ]);
  qc.setQueryData(["admin", "cancellation-reasons", "all"], [
    {
      id: "cr-1",
      actor_type: "customer",
      name_en: "Schedule conflict",
      name_ar: "تعارض في المواعيد",
      is_active: true,
      sort_order: 1,
    },
  ]);
  qc.setQueryData(["admin", "campaigns"], [
    {
      id: "camp-1",
      title_en: "Welcome back",
      title_ar: "أهلاً بعودتك",
      body_en: "Book again this week and save 15%",
      body_ar: "احجز مرة أخرى هذا الأسبوع ووفر ١٥٪",
      target: "customers",
      channel_push: true,
      status: "draft",
      scheduled_for: null,
      created_at: now,
    },
  ]);
  qc.setQueryData(["admin", "reminder-rules"], [
    { id: "rr-1", lead_minutes: 1440, is_active: true },
    { id: "rr-2", lead_minutes: 120, is_active: true },
  ]);
  qc.setQueryData(["admin", "operations-summary"], [
    { queue: "pending_provider_services", item_count: 2, oldest_at: now },
    { queue: "pending_requirement_reviews", item_count: 1, oldest_at: now },
    { queue: "flagged_provider_pricing", item_count: 0, oldest_at: null },
    { queue: "open_disputes", item_count: 1, oldest_at: now },
    { queue: "open_no_show_reports", item_count: 0, oldest_at: null },
    { queue: "open_support_tickets", item_count: 2, oldest_at: now },
    { queue: "stuck_completion_requests", item_count: 1, oldest_at: now },
    { queue: "payments_needing_review", item_count: 1, oldest_at: now },
    { queue: "notification_delivery_failures", item_count: 1, oldest_at: now },
  ]);
  qc.setQueryData(["admin", "operations", "pending-provider-services"], [
    {
      id: "ps-pending",
      provider_id: PREVIEW_ADMIN_PROVIDER_PENDING,
      created_at: now,
      provider: { id: PREVIEW_ADMIN_PROVIDER_PENDING, profile: { full_name: "Nadia Kamal" } },
      service: { name_en: "Deep home clean", name_ar: "تنظيف منزل عميق" },
    },
  ]);
  qc.setQueryData(["admin", "operations", "flagged-provider-pricing"], []);
  qc.setQueryData(["admin", "operations", "pending-requirement-reviews"], []);
  qc.setQueryData(["admin", "operations", "notification-failures"], [
    {
      id: "nf-1",
      recipient_user_id: PREVIEW_USER_ID,
      status: "failed",
      attempts: 3,
      last_error_safe: "Push token expired",
      created_at: now,
      next_attempt_at: now,
    },
  ]);
  qc.setQueryData(["admin", "monitoring-summary", 7], {
    recent_errors: 2,
    failed_payments: 1,
    failed_notifications: 1,
    oldest_error_at: now,
    oldest_failed_payment_at: now,
    oldest_failed_notification_at: now,
  });
  qc.setQueryData(["admin", "monitoring", "error-logs", 7], [
    {
      id: "err-1",
      created_at: now,
      message_safe: "Payment webhook timeout",
      source: "edge",
      context_route: "/payments",
      context_label: "capture",
    },
  ]);
  qc.setQueryData(["admin", "monitoring", "failed-payments"], [
    { id: "fp-1", status: "failed", created_at: now, booking_id: "admin-booking-2" },
  ]);
  qc.setQueryData(["admin", "monitoring", "failed-notifications"], [
    {
      id: "fn-1",
      status: "failed",
      attempts: 2,
      last_error_safe: "Invalid device token",
      created_at: now,
    },
  ]);
  qc.setQueryData(["admin", "support-tickets", {}], [
    {
      id: "ticket-1",
      status: "open",
      category: "booking",
      subject: "Provider arrived late",
      created_at: now,
      booking_id: "admin-booking-1",
      customer_id: PREVIEW_USER_ID,
    },
  ]);
  qc.setQueryData(["admin", "disputes", {}], [
    {
      id: "dispute-1",
      status: "open",
      created_at: now,
      booking_id: "admin-booking-1",
      customer_id: PREVIEW_USER_ID,
      provider_id: PREVIEW_PROVIDER_ID,
      reason: "Service quality concern",
    },
  ]);
  qc.setQueryData(["admin", "no-show-reports", {}], []);
  qc.setQueryData(["admin", "audit-log", "entities"], {
    actions: ["booking.status_changed", "provider.verified"],
    entities: ["bookings", "providers"],
    actors: [{ id: PREVIEW_USER_ID, name: "Admin User" }],
  });
  qc.setQueryData(["admin", "audit-log", {}, 0], {
    rows: [
      {
        id: "audit-1",
        actor_id: PREVIEW_USER_ID,
        actor_role: "admin",
        action: "provider.verified",
        entity: "providers",
        entity_id: PREVIEW_PROVIDER_ID,
        booking_id: null,
        reason: "Documents approved",
        correlation_id: null,
        old_values: { is_verified: false },
        new_values: { is_verified: true },
        diff: null,
        created_at: now,
        booking: null,
        actor_name: "Admin User",
      },
    ],
    total: 1,
  });
}
