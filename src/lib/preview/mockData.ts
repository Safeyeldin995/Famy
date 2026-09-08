import { PREVIEW_USER_ID } from "@/lib/preview/constants";
import { addressesQueryKey, defaultAddressQueryKey } from "@/lib/db/address-query-keys";

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

const start = new Date();
start.setDate(start.getDate() + 2);
start.setHours(10, 0, 0, 0);
const end = new Date(start);
end.setHours(start.getHours() + 3);

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
    start_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    end_at: new Date(Date.now() - 86400000 * 5 + 7200000).toISOString(),
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
    updated_at: new Date().toISOString(),
    other_name: "Mona Adel",
    other_avatar: "https://i.pravatar.cc/240?img=47",
    last_message: "I'll arrive 10 minutes early to set up.",
    last_time: new Date().toISOString(),
  },
];

export const previewMessages = [
  {
    id: "m1",
    conversation_id: "conv-1",
    sender_id: "provider-user-1",
    body: "Hi Sara! Looking forward to your booking tomorrow.",
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "m2",
    conversation_id: "conv-1",
    sender_id: PREVIEW_USER_ID,
    body: "Great, please ring the intercom when you arrive.",
    created_at: new Date(Date.now() - 3000000).toISOString(),
  },
  {
    id: "m3",
    conversation_id: "conv-1",
    sender_id: "provider-user-1",
    body: "I'll arrive 10 minutes early to set up.",
    created_at: new Date().toISOString(),
  },
];

export function seedPreviewQueries(qc: import("@tanstack/react-query").QueryClient) {
  const profile = { id: PREVIEW_USER_ID, full_name: "Sara Hassan", phone: "+201012345678", avatar_url: null };

  qc.setQueryData(["my-profile"], profile);
  qc.setQueryData(defaultAddressQueryKey(PREVIEW_USER_ID), previewAddresses[0]);
  qc.setQueryData(addressesQueryKey(PREVIEW_USER_ID), previewAddresses);
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
  qc.setQueryData(["provider", "p1", undefined], p1);
  qc.setQueryData(["provider-reviews", "p1"], []);
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
      created_at: new Date().toISOString(),
      deep_link: "/bookings",
    },
    {
      id: "n2",
      title_en: "20% off your first booking",
      body_en: "Use code FAMY20 before it expires.",
      title_ar: "خصم ٢٠٪",
      body_ar: "استخدمي الكود FAMY20",
      read_at: new Date().toISOString(),
      category: "campaign",
      created_at: new Date(Date.now() - 86400000).toISOString(),
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
}
