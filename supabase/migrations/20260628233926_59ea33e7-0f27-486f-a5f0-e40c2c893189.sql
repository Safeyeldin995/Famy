
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'instapay';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'rejected';
