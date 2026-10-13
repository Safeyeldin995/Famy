import type { QueryClient } from "@tanstack/react-query";

/** Synthetic admin-only catalog data. Never used outside the guarded preview routes. */
export function seedAdminCatalog(qc: QueryClient) {
  qc.setQueryData(["settings", "booking_expiry"], {
    pending_ttl_hours: 24,
    min_hours_before_start: 2,
  });
  for (const key of ["terms", "privacy", "about", "contact"])
    qc.setQueryData(["settings", "content", key], {
      body_ar: "نص تجريبي للمعاينة بس. راجع المحتوى قبل النشر.",
      body_en: "Synthetic preview content only.",
    });
  const categories = [
    {
      id: "cat-kids",
      slug: "babysitting",
      name_ar: "جليسة أطفال",
      name_en: "Babysitting",
      is_active: true,
      sort_order: 1,
    },
    {
      id: "cat-tutoring",
      slug: "tutoring",
      name_ar: "دروس خصوصية",
      name_en: "Tutoring",
      is_active: true,
      sort_order: 2,
    },
  ];
  const services = [
    {
      id: "catalog-night",
      category_id: "cat-kids",
      category: categories[0],
      slug: "overnight-babysitting",
      name_ar: "جليسة ليلية",
      name_en: "Evening babysitting",
      base_price: 600,
      minimum_price: 500,
      maximum_price: 900,
      maximum_extras_total: 100,
      duration_min: 360,
      fixed_start_time: "18:00",
      pricing_model: "fixed",
      is_active: true,
      provider_pricing_allowed: true,
      allowed_session_durations: null,
    },
    {
      id: "catalog-teaching",
      category_id: "cat-tutoring",
      category: categories[1],
      slug: "school-tutoring",
      name_ar: "دروس المواد الدراسية",
      name_en: "School tutoring",
      base_price: 300,
      minimum_price: 200,
      maximum_price: 600,
      maximum_extras_total: 0,
      duration_min: 60,
      fixed_start_time: null,
      pricing_model: "hourly",
      is_active: false,
      provider_pricing_allowed: true,
      allowed_session_durations: [60, 90, 120],
    },
  ];
  qc.setQueryData(["admin", "categories"], categories);
  qc.setQueryData(["admin", "services"], services);
  for (const service of services) {
    qc.setQueryData(["admin", "requirements", service.id], []);
    qc.setQueryData(["admin", "flagged-provider-services", service.id], []);
  }
  qc.setQueryData(["admin", "zone-services", "zone-maadi"], new Set(services.map((s) => s.id)));
  const promos = [
    {
      id: "promo1",
      code: "FAMY20",
      description_en: "Welcome discount",
      description_ar: "خصم لأول حجز",
      discount_type: "percentage",
      discount_value: 20,
      maximum_discount: 100,
      minimum_booking_amount: 200,
      starts_at: null,
      expires_at: "2027-01-01T20:00:00Z",
      total_usage_limit: 100,
      usage_limit_per_customer: 1,
      usage_count: 3,
      first_booking_only: true,
      applicable_scope: "all",
      is_featured: true,
      is_active: true,
    },
  ];
  qc.setQueryData(["admin", "promo-codes"], promos);
  qc.setQueryData(["admin", "promo-codes", "promo1", "scope"], { categoryIds: [], serviceIds: [] });
  qc.setQueryData(
    ["admin", "payment-methods"],
    [
      {
        id: "pm-cash",
        code: "cash",
        name_ar: "كاش بعد الخدمة",
        name_en: "Cash",
        method_type: "cash",
        is_active: true,
        is_default: true,
        display_order: 1,
        public_config: {},
        instructions_ar: "ادفع لمقدم الخدمة بعد ما الخدمة تخلص.",
        instructions_en: "Pay after the service.",
      },
      {
        id: "pm-transfer",
        code: "instapay",
        name_ar: "إنستاباي",
        name_en: "InstaPay",
        method_type: "manual_transfer",
        is_active: true,
        is_default: false,
        display_order: 2,
        public_config: { handle: "demo-only", note: "معاينة بس" },
        instructions_ar: "حول المبلغ وارفع صورة الإيصال للمراجعة.",
        instructions_en: "Upload your transfer receipt.",
      },
    ],
  );
  const reasons = [
    {
      id: "cr-1",
      actor_type: "customer",
      code: "schedule_conflict",
      name_ar: "ميعادي اتغير",
      name_en: "Schedule changed",
      description_ar: "اختار ميعاد تاني يناسبك",
      description_en: "Choose another time",
      is_active: true,
      display_order: 1,
      requires_note: false,
    },
    {
      id: "cr-2",
      actor_type: "provider",
      code: "emergency",
      name_ar: "ظرف طارئ",
      name_en: "Emergency",
      description_ar: "وضح السبب للإدارة",
      description_en: "Explain to support",
      is_active: false,
      display_order: 1,
      requires_note: true,
    },
  ];
  for (const actor of ["all", "customer", "provider", "admin"])
    qc.setQueryData(
      ["admin", "cancellation-reasons", actor],
      actor === "all" ? reasons : reasons.filter((r) => r.actor_type === actor),
    );
  for (const [key, name_ar, name_en] of [
    ["teaching-curricula", "المنهج المصري", "Egyptian"],
    ["teaching-levels", "الصف الأول", "Grade 1"],
    ["teaching-subjects", "رياضيات", "Mathematics"],
  ]) {
    qc.setQueryData(
      [key, true],
      [
        {
          id: key + "-demo",
          code: "demo",
          name_ar,
          name_en,
          is_active: true,
          sort_order: 1,
          max_session_duration_min: 120,
        },
      ],
    );
  }
}
