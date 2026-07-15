-- bookings.customer_id was FK'd to auth.users(id), but every admin/provider
-- screen embeds the customer via PostgREST's `profiles!bookings_customer_id_fkey`
-- relationship hint. PostgREST can only auto-detect embeds through a real FK
-- pointing at the embedded table, so every query using that hint (admin
-- bookings/cases/payments, provider's own booking list) failed with PGRST200
-- ("Could not find a relationship between 'bookings' and 'profiles'").
--
-- profiles.id is the same value as auth.users.id for every account (enforced
-- by handle_new_user() creating both rows together), so retargeting the FK
-- to public.profiles(id) — keeping the same constraint name so every existing
-- `!bookings_customer_id_fkey` hint keeps working — is a safe, lossless swap.
-- This mirrors how providers.profile_id already references public.profiles(id)
-- directly.
ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_customer_id_fkey,
  ADD CONSTRAINT bookings_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
