import { readPaymobConfig } from "./paymobConfig.server";
import { createPaymobIntention, PaymobIntentionIndeterminateError } from "./paymobApi.server";
import { buildPaymobBookingReturnUrl } from "./paymobConfig.server";

type BookingRow = {
  id: string;
  customer_id: string;
  price_total: number | null;
  currency: string | null;
  service?: { name_en?: string | null; name_ar?: string | null } | null;
};

type PaymentRow = {
  id: string;
  booking_id: string;
  customer_id: string;
  amount: number;
  currency: string | null;
  status: string;
  payment_method_code: string | null;
  payment_method_type: string | null;
};

type ProfileRow = {
  full_name: string | null;
  phone: string | null;
};

type PostgrestResult = Promise<{ data: unknown; error: { message: string } | null }>;

type SupabaseQueryBuilder = {
  select: (columns: string) => SupabaseQueryBuilder;
  eq: (column: string, value: unknown) => SupabaseQueryBuilder;
  order: (column: string, opts?: { ascending?: boolean }) => SupabaseQueryBuilder;
  limit: (count: number) => SupabaseQueryBuilder;
  maybeSingle: () => PostgrestResult;
  single: () => PostgrestResult;
};

export type SupabaseAdminClient = {
  from: (table: string) => SupabaseQueryBuilder;
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function bookingAmountCents(amount: number): number {
  return Math.round(amount * 100);
}

function defaultBillingFromProfile(profile: ProfileRow | null | undefined): {
  first_name: string;
  last_name: string;
  phone_number: string;
  email: string;
} {
  const fullName = profile?.full_name?.trim() || "Famy Customer";
  const parts = fullName.split(/\s+/);
  const first_name = parts[0] || "Famy";
  const last_name = parts.slice(1).join(" ") || "Customer";
  const phone = profile?.phone?.trim();
  const phone_number = phone && phone.startsWith("+") ? phone : "+201000000000";
  return {
    first_name,
    last_name,
    phone_number,
    email: "customer@famy.app",
  };
}

export async function createPaymobCheckoutForPayment(input: {
  supabaseAdmin: SupabaseAdminClient;
  userId: string;
  bookingId: string;
  paymentId?: string;
}): Promise<{ checkoutUrl: string; paymentId: string }> {
  const config = readPaymobConfig();

  const { data: booking, error: bookingErr } = await input.supabaseAdmin
    .from("bookings")
    .select("id, customer_id, price_total, currency, service:services(name_en, name_ar)")
    .eq("id", input.bookingId)
    .single();
  if (bookingErr || !booking) throw new Error("Booking not found.");
  const bookingRow = booking as BookingRow;
  if (bookingRow.customer_id !== input.userId) {
    throw new Error("You cannot pay for this booking.");
  }

  const paymentSelect =
    "id, booking_id, customer_id, amount, currency, status, payment_method_code, payment_method_type";
  const paymentQuery = input.paymentId
    ? input.supabaseAdmin
        .from("payments")
        .select(paymentSelect)
        .eq("id", input.paymentId)
        .eq("booking_id", input.bookingId)
        .eq("customer_id", input.userId)
        .maybeSingle()
    : input.supabaseAdmin
        .from("payments")
        .select(paymentSelect)
        .eq("booking_id", input.bookingId)
        .eq("customer_id", input.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const { data: paymentData, error: paymentErr } = await paymentQuery;
  if (paymentErr || !paymentData) throw new Error("Payment not found for this booking.");
  const payment = paymentData as PaymentRow;

  if (payment.payment_method_code !== "paymob" || payment.payment_method_type !== "online") {
    throw new Error("This booking is not using Paymob online payment.");
  }

  const authoritativeAmount = Number(bookingRow.price_total);
  const paymentAmount = Number(payment.amount);
  if (
    !Number.isFinite(authoritativeAmount) ||
    authoritativeAmount <= 0 ||
    Math.abs(authoritativeAmount - paymentAmount) > 0.01
  ) {
    throw new Error("Payment amount does not match the booking total.");
  }

  const { data: reservation, error: reserveErr } = await input.supabaseAdmin.rpc(
    "paymob_reserve_checkout",
    {
      p_payment_id: payment.id,
    },
  );
  if (reserveErr) {
    if (reserveErr.message.includes("already in progress")) {
      throw new Error("Paymob checkout is already in progress for this payment.");
    }
    throw new Error(reserveErr.message || "Could not reserve Paymob checkout.");
  }

  const reservationRow = reservation as {
    reused?: boolean;
    checkout_url?: string;
    payment_id?: string;
  } | null;

  if (reservationRow?.reused && reservationRow.checkout_url) {
    return { checkoutUrl: reservationRow.checkout_url, paymentId: payment.id };
  }

  const { data: profile } = await input.supabaseAdmin
    .from("profiles")
    .select("full_name, phone")
    .eq("id", input.userId)
    .maybeSingle();

  const billing = defaultBillingFromProfile(profile as ProfileRow | null);
  const serviceName = bookingRow.service?.name_en || bookingRow.service?.name_ar || "Famy booking";
  const amountCents = bookingAmountCents(paymentAmount);
  const currency = (payment.currency || bookingRow.currency || "EGP").toUpperCase();

  const releaseReservation = async () => {
    const { error: releaseErr } = await input.supabaseAdmin.rpc(
      "paymob_release_checkout_reservation",
      { p_payment_id: payment.id },
    );
    if (releaseErr) {
      console.error("[paymob.checkout] failed to release checkout reservation", releaseErr.message);
    }
  };

  let intention: Awaited<ReturnType<typeof createPaymobIntention>>;
  try {
    intention = await createPaymobIntention(config, {
      amountCents,
      currency,
      specialReference: payment.id,
      notificationUrl: config.notificationUrl,
      redirectionUrl: buildPaymobBookingReturnUrl(config.appOrigin, bookingRow.id),
      billingData: {
        ...billing,
        street: "NA",
        building: "NA",
        floor: "NA",
        apartment: "NA",
        city: "Cairo",
        country: "EGY",
        state: "Cairo",
      },
      items: [
        {
          name: serviceName,
          amount: amountCents,
          description: `Booking ${bookingRow.id.slice(0, 8)}`,
          quantity: 1,
        },
      ],
    });
  } catch (err) {
    if (!(err instanceof PaymobIntentionIndeterminateError)) {
      // Paymob explicitly rejected the request (bad request, malformed response) —
      // proven no intention was created, safe to release immediately.
      await releaseReservation();
    }
    // else: we don't know whether Paymob created the intention (network error,
    // timeout, lost response). Keep the reservation so a fast retry can't create
    // a second live intention for the same payment — it self-expires after 15
    // minutes if nothing else resolves it.
    throw err;
  }

  const { error: storeErr } = await input.supabaseAdmin.rpc("paymob_store_checkout_intention", {
    p_payment_id: payment.id,
    p_intention_id: intention.intentionId,
    p_checkout_url: intention.checkoutUrl,
    p_extra_metadata: {},
  });
  if (storeErr) {
    console.error("[paymob.checkout] failed to persist intention metadata", storeErr.message);
    await releaseReservation();
    throw new Error("Could not save Paymob checkout details.");
  }

  return { checkoutUrl: intention.checkoutUrl, paymentId: payment.id };
}
