-- Services Phase 4B: closed-beta service catalog.
-- Seeds 18 services (3 per existing category), resolving category_id by
-- slug so nothing here depends on category UUIDs. Idempotent via
-- ON CONFLICT (slug) — safe to re-run. No providers, bookings, reviews,
-- prices, ratings, or statistics are touched.
--
-- base_price/duration_min/pricing_model are set to schema defaults
-- (0 / 60 / 'hourly') per instruction — actual booking pricing still comes
-- from provider_services.price_override / providers.hourly_rate, unchanged.

INSERT INTO public.services (category_id, slug, name_en, name_ar, base_price, duration_min, pricing_model, is_active)
SELECT c.id, v.slug, v.name_en, v.name_ar, 0, 60, 'hourly', true
FROM (VALUES
  ('home-cleaning', 'regular-home-cleaning',        'Regular Home Cleaning',        'تنظيف منزلي عادي'),
  ('home-cleaning', 'deep-home-cleaning',           'Deep Home Cleaning',           'تنظيف منزلي عميق'),
  ('home-cleaning', 'move-in-out-cleaning',         'Move-in / Move-out Cleaning',  'تنظيف قبل السكن أو بعد الانتقال'),

  ('babysitting',   'hourly-babysitting',           'Hourly Babysitting',           'جليسة أطفال بالساعة'),
  ('babysitting',   'full-day-babysitting',         'Full-Day Babysitting',         'جليسة أطفال ليوم كامل'),
  ('babysitting',   'overnight-babysitting',        'Overnight Babysitting',        'جليسة أطفال ليلية'),

  ('elderly-care',  'elderly-companionship',        'Elderly Companionship',        'مرافقة كبار السن'),
  ('elderly-care',  'elderly-daily-assistance',     'Daily Elderly Assistance',     'مساعدة يومية لكبار السن'),
  ('elderly-care',  'elderly-overnight-assistance', 'Overnight Elderly Assistance', 'رعاية ليلية لكبار السن'),

  ('cooking',       'daily-home-cooking',           'Daily Home Cooking',           'طبخ منزلي يومي'),
  ('cooking',       'weekly-meal-preparation',      'Weekly Meal Preparation',      'تحضير وجبات الأسبوع'),
  ('cooking',       'small-gathering-cooking',      'Small Gathering Cooking',      'طبخ للعزومات الصغيرة'),

  ('tutoring',      'homework-support',             'Homework Support',             'مساعدة في الواجبات'),
  ('tutoring',      'school-subject-tutoring',      'School Subject Tutoring',      'دروس خصوصية للمواد الدراسية'),
  ('tutoring',      'language-tutoring',            'Language Tutoring',            'دروس خصوصية في اللغات'),

  ('pet-care',      'pet-sitting',                  'Pet Sitting',                  'رعاية الحيوانات الأليفة'),
  ('pet-care',      'dog-walking',                  'Dog Walking',                  'تمشية الكلاب'),
  ('pet-care',      'pet-feeding-home-visits',      'Feeding & Home Visits',        'إطعام الحيوانات والزيارات المنزلية')
) AS v(category_slug, slug, name_en, name_ar)
JOIN public.categories c ON c.slug = v.category_slug
ON CONFLICT (slug) DO UPDATE SET
  category_id   = EXCLUDED.category_id,
  name_en       = EXCLUDED.name_en,
  name_ar       = EXCLUDED.name_ar,
  base_price    = EXCLUDED.base_price,
  duration_min  = EXCLUDED.duration_min,
  pricing_model = EXCLUDED.pricing_model,
  is_active     = EXCLUDED.is_active;
