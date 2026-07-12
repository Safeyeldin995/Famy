-- Booking Lifecycle Phase 3A (1/2): new booking_status enum values.
-- Must ship in its own transaction/migration — Postgres will not let a
-- newly added enum value be referenced (even as a string literal cast)
-- inside the same transaction that added it. Everything that uses these
-- values (columns, trigger, notifications) lives in the next migration,
-- which runs as its own, later transaction.
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'on_the_way' AFTER 'confirmed';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'arrived' AFTER 'on_the_way';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'completion_requested' AFTER 'in_progress';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'disputed' AFTER 'completion_requested';
