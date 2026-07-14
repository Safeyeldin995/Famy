-- Follow-up to 20260714220000: PostgREST only infers a one-to-one embed
-- (`cancellation:booking_cancellations(*)` as an object, not an array) from
-- an actual UNIQUE constraint on the FK column — a plain unique index isn't
-- enough. Promotes the existing index into a constraint in place, no rebuild.
ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_booking_id_key UNIQUE USING INDEX booking_cancellations_one_per_booking;
