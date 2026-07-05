
-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE public.app_role AS ENUM ('customer', 'provider', 'admin');
CREATE TYPE public.booking_status AS ENUM ('pending','confirmed','in_progress','completed','cancelled','no_show');
CREATE TYPE public.payment_status AS ENUM ('pending','authorized','captured','failed','refunded','partially_refunded');
CREATE TYPE public.payment_method AS ENUM ('card','wallet','cash');
CREATE TYPE public.verification_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.document_type AS ENUM ('id_card','passport','criminal_record','certificate','other');
CREATE TYPE public.coupon_type AS ENUM ('percent','fixed');
CREATE TYPE public.ticket_status AS ENUM ('open','pending','resolved','closed');
CREATE TYPE public.notification_channel AS ENUM ('in_app','email','sms','push','whatsapp');

-- ============================================================
-- UTILITY: updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============================================================
-- PROFILES (1:1 auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text UNIQUE,
  email text,
  avatar_url text,
  locale text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- USER ROLES + has_role
-- ============================================================
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Profile/role policies
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_admin_select" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles_self_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "roles_self_select" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- Auto-create profile + default customer role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, phone, email, full_name)
  VALUES (NEW.id, NEW.phone, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer');
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- CATEGORIES + SERVICES
-- ============================================================
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  description_en text,
  description_ar text,
  icon text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_categories_parent ON public.categories(parent_id);
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories_public_read" ON public.categories FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY "categories_admin_all" ON public.categories FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_categories_updated BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  description_en text,
  description_ar text,
  base_price numeric(10,2) NOT NULL DEFAULT 0,
  duration_min int NOT NULL DEFAULT 60,
  pricing_model text NOT NULL DEFAULT 'hourly', -- hourly|fixed|per_visit
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_services_category ON public.services(category_id);
GRANT SELECT ON public.services TO anon, authenticated;
GRANT ALL ON public.services TO service_role;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "services_public_read" ON public.services FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY "services_admin_all" ON public.services FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_services_updated BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- PROVIDERS
-- ============================================================
CREATE TABLE public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  bio_en text,
  bio_ar text,
  years_experience int NOT NULL DEFAULT 0,
  languages text[] NOT NULL DEFAULT '{}',
  hourly_rate numeric(10,2) NOT NULL DEFAULT 0,
  city text,
  country text NOT NULL DEFAULT 'EG',
  is_active boolean NOT NULL DEFAULT true,
  is_verified boolean NOT NULL DEFAULT false,
  is_top_pro boolean NOT NULL DEFAULT false,
  response_time_min int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_providers_active ON public.providers(is_active, is_verified);
GRANT SELECT ON public.providers TO anon, authenticated;
GRANT INSERT, UPDATE ON public.providers TO authenticated;
GRANT ALL ON public.providers TO service_role;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "providers_public_read" ON public.providers FOR SELECT TO anon, authenticated USING (is_active AND is_verified);
CREATE POLICY "providers_self_read" ON public.providers FOR SELECT TO authenticated USING (profile_id = auth.uid());
CREATE POLICY "providers_self_upsert" ON public.providers FOR INSERT TO authenticated WITH CHECK (profile_id = auth.uid());
CREATE POLICY "providers_self_update" ON public.providers FOR UPDATE TO authenticated USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
CREATE POLICY "providers_admin_all" ON public.providers FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_providers_updated BEFORE UPDATE ON public.providers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.provider_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  price_override numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, service_id)
);
CREATE INDEX idx_ps_provider ON public.provider_services(provider_id);
CREATE INDEX idx_ps_service ON public.provider_services(service_id);
GRANT SELECT ON public.provider_services TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.provider_services TO authenticated;
GRANT ALL ON public.provider_services TO service_role;
ALTER TABLE public.provider_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ps_public_read" ON public.provider_services FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ps_provider_manage" ON public.provider_services FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));
CREATE POLICY "ps_admin_all" ON public.provider_services FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.provider_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  type public.document_type NOT NULL,
  storage_path text NOT NULL,
  status public.verification_status NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_documents TO authenticated;
GRANT ALL ON public.provider_documents TO service_role;
ALTER TABLE public.provider_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "docs_self" ON public.provider_documents FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));
CREATE POLICY "docs_admin" ON public.provider_documents FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_docs_updated BEFORE UPDATE ON public.provider_documents FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.verification_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status public.verification_status NOT NULL DEFAULT 'pending',
  verified_by uuid REFERENCES auth.users(id),
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.verification_records TO authenticated;
GRANT ALL ON public.verification_records TO service_role;
ALTER TABLE public.verification_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vr_self_read" ON public.verification_records FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));
CREATE POLICY "vr_admin_all" ON public.verification_records FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- AVAILABILITY
-- ============================================================
CREATE TABLE public.availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL CHECK (end_time > start_time),
  timezone text NOT NULL DEFAULT 'Africa/Cairo',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_avail_provider ON public.availability_rules(provider_id);
GRANT SELECT ON public.availability_rules TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.availability_rules TO authenticated;
GRANT ALL ON public.availability_rules TO service_role;
ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "avail_public_read" ON public.availability_rules FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "avail_self_manage" ON public.availability_rules FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));

CREATE TABLE public.availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  date date NOT NULL,
  is_blocked boolean NOT NULL DEFAULT true,
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_avail_exc_provider_date ON public.availability_exceptions(provider_id, date);
GRANT SELECT ON public.availability_exceptions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.availability_exceptions TO authenticated;
GRANT ALL ON public.availability_exceptions TO service_role;
ALTER TABLE public.availability_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "avail_exc_public_read" ON public.availability_exceptions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "avail_exc_self_manage" ON public.availability_exceptions FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));

-- ============================================================
-- ADDRESSES + FAVORITES
-- ============================================================
CREATE TABLE public.addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text,
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  area text,
  country text NOT NULL DEFAULT 'EG',
  lat double precision,
  lng double precision,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_addresses_user ON public.addresses(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.addresses TO authenticated;
GRANT ALL ON public.addresses TO service_role;
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "addresses_self" ON public.addresses FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_addresses_updated BEFORE UPDATE ON public.addresses FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider_id)
);
CREATE INDEX idx_favorites_user ON public.favorites(user_id);
GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.favorites TO service_role;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "favorites_self" ON public.favorites FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- BOOKINGS (+ btree_gist for overlap exclusion)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  address_id uuid REFERENCES public.addresses(id) ON DELETE SET NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL CHECK (end_at > start_at),
  status public.booking_status NOT NULL DEFAULT 'pending',
  price_subtotal numeric(10,2) NOT NULL DEFAULT 0,
  price_discount numeric(10,2) NOT NULL DEFAULT 0,
  price_total numeric(10,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EGP',
  coupon_id uuid,
  payment_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- prevent overlapping active bookings per provider
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    provider_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status IN ('pending','confirmed','in_progress'))
);
CREATE INDEX idx_bookings_customer ON public.bookings(customer_id, start_at DESC);
CREATE INDEX idx_bookings_provider ON public.bookings(provider_id, start_at DESC);
CREATE INDEX idx_bookings_status ON public.bookings(status);
GRANT SELECT, INSERT, UPDATE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bookings_customer_select" ON public.bookings FOR SELECT TO authenticated USING (customer_id = auth.uid());
CREATE POLICY "bookings_provider_select" ON public.bookings FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));
CREATE POLICY "bookings_admin_all" ON public.bookings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "bookings_customer_insert" ON public.bookings FOR INSERT TO authenticated WITH CHECK (customer_id = auth.uid());
CREATE POLICY "bookings_customer_update" ON public.bookings FOR UPDATE TO authenticated USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid());
CREATE POLICY "bookings_provider_update" ON public.bookings FOR UPDATE TO authenticated
  USING (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.booking_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  from_status public.booking_status,
  to_status public.booking_status NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bsh_booking ON public.booking_status_history(booking_id);
GRANT SELECT ON public.booking_status_history TO authenticated;
GRANT ALL ON public.booking_status_history TO service_role;
ALTER TABLE public.booking_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bsh_party_read" ON public.booking_status_history FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND (
    b.customer_id = auth.uid()
    OR EXISTS(SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = auth.uid())
  ))
);
CREATE POLICY "bsh_admin_all" ON public.booking_status_history FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- audit trigger
CREATE OR REPLACE FUNCTION public.tg_booking_status_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, auth.uid());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_booking_status_audit AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_status_audit();

-- ============================================================
-- REVIEWS
-- ============================================================
CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  provider_reply text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reviews_provider ON public.reviews(provider_id);
GRANT SELECT ON public.reviews TO anon, authenticated;
GRANT INSERT, UPDATE ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_public_read" ON public.reviews FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "reviews_customer_insert" ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid() AND EXISTS(SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.customer_id = auth.uid() AND b.status = 'completed'));
CREATE POLICY "reviews_customer_update" ON public.reviews FOR UPDATE TO authenticated USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid());
CREATE POLICY "reviews_provider_reply" ON public.reviews FOR UPDATE TO authenticated
  USING (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));
CREATE TRIGGER trg_reviews_updated BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.ratings_summary (
  provider_id uuid PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
  rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  rating_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ratings_summary TO anon, authenticated;
GRANT ALL ON public.ratings_summary TO service_role;
ALTER TABLE public.ratings_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ratings_public_read" ON public.ratings_summary FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.tg_refresh_ratings_summary()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid;
BEGIN
  pid := COALESCE(NEW.provider_id, OLD.provider_id);
  INSERT INTO public.ratings_summary(provider_id, rating_avg, rating_count, updated_at)
  SELECT pid, COALESCE(AVG(rating),0)::numeric(3,2), COUNT(*), now()
  FROM public.reviews WHERE provider_id = pid
  ON CONFLICT (provider_id) DO UPDATE
    SET rating_avg = EXCLUDED.rating_avg, rating_count = EXCLUDED.rating_count, updated_at = now();
  RETURN NULL;
END; $$;
CREATE TRIGGER trg_ratings_summary AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_refresh_ratings_summary();

-- ============================================================
-- COUPONS + PAYMENTS
-- ============================================================
CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  type public.coupon_type NOT NULL,
  value numeric(10,2) NOT NULL,
  min_total numeric(10,2) NOT NULL DEFAULT 0,
  max_uses int,
  uses_count int NOT NULL DEFAULT 0,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coupons_auth_read_active" ON public.coupons FOR SELECT TO authenticated USING (is_active);
CREATE POLICY "coupons_admin_all" ON public.coupons FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cr_coupon ON public.coupon_redemptions(coupon_id);
GRANT SELECT, INSERT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cr_self" ON public.coupon_redemptions FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider_ref text,
  method public.payment_method NOT NULL,
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  status public.payment_status NOT NULL DEFAULT 'pending',
  captured_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_booking ON public.payments(booking_id);
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_customer_read" ON public.payments FOR SELECT TO authenticated USING (customer_id = auth.uid());
CREATE POLICY "payments_admin_all" ON public.payments FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  kind text NOT NULL, -- charge|refund|payout
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tx_admin_all" ON public.transactions FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- NOTIFICATIONS / SUPPORT / AUDIT / SETTINGS / TRUST
-- ============================================================
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel public.notification_channel NOT NULL DEFAULT 'in_app',
  type text NOT NULL,
  title text NOT NULL,
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user ON public.notifications(user_id, created_at DESC);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_self" ON public.notifications FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  status public.ticket_status NOT NULL DEFAULT 'open',
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tickets_self" ON public.support_tickets FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "tickets_admin" ON public.support_tickets FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_tickets_updated BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ticket_messages TO authenticated;
GRANT ALL ON public.ticket_messages TO service_role;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tm_party" ON public.ticket_messages FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND (t.user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))))
  WITH CHECK (author_id = auth.uid());

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_admin" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.settings TO anon, authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_public_read" ON public.settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "settings_admin_write" ON public.settings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.trust_scores (
  provider_id uuid PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
  score numeric(5,2) NOT NULL DEFAULT 0,
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.trust_scores TO anon, authenticated;
GRANT ALL ON public.trust_scores TO service_role;
ALTER TABLE public.trust_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trust_public_read" ON public.trust_scores FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- SEED: categories + base settings
-- ============================================================
INSERT INTO public.categories (slug, name_en, name_ar, icon, sort_order) VALUES
  ('home-cleaning','Home Cleaning','تنظيف المنازل','sparkles',1),
  ('babysitting','Babysitting','جليسة أطفال','baby',2),
  ('elderly-care','Elderly Care','رعاية المسنين','heart-handshake',3),
  ('cooking','Cooking','طبخ','chef-hat',4),
  ('tutoring','Tutoring','دروس خصوصية','graduation-cap',5),
  ('pet-care','Pet Care','رعاية الحيوانات','paw-print',6);

INSERT INTO public.settings (key, value) VALUES
  ('commission_pct', '15'::jsonb),
  ('cancellation_window_hours', '12'::jsonb),
  ('cash_enabled', 'true'::jsonb),
  ('currency', '"EGP"'::jsonb);
