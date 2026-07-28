-- Customers must use create_booking; direct INSERT must fail at privilege/RLS
-- before marketplace eligibility or pricing triggers can run.
REVOKE INSERT ON public.bookings FROM authenticated;

NOTIFY pgrst, 'reload schema';
