import { readPaymobConfig } from "./paymobConfig.server";
import { createPaymobIntention } from "./paymobApi.server";
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
  supabaseAdmin: {
    from: (table: string) => any;
  };
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

  const paymentSelect = "id, booking_id, customer_id, amount, currency, status, payment_method_code, payment_method_type";
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
  if (payment.status === "captured") {
    throw new Error("This payment is already completed.");
  }
  if (payment.status === "rejected") {
    throw new Error("This payment was rejected. Start a new booking payment if needed.");
  }

  const authoritativeAmount = Number(bookingRow.price_total);
  const paymentAmount = Number(payment.amount);
  if (
    !Number.isFinite(authoritativeAmount)
    || authoritativeAmount <= 0
    || Math.abs(authoritativeAmount - paymentAmount) > 0.01
  ) {
    throw new Error("Payment amount does not match the booking total.");
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

  const intention = await createPaymobIntention(config, {
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
    items: [{
      name: serviceName,
      amount: amountCents,
      description: `Booking ${bookingRow.id.slice(0, 8)}`,
      quantity: 1,
    }],
  });

  const { error: metaErr } = await input.supabaseAdmin
    .from("payments")
    .update({
      provider_ref: intention.intentionId,
      metadata: {
        paymob_intention_id: intention.intentionId,
        paymob_checkout_started_at: new Date().toISOString(),
      },
    })
    .eq("id", payment.id);
  if (metaErr) {
    console.error("[paymob.checkout] failed to persist intention metadata", metaErr.message);
  }

  return { checkoutUrl: intention.checkoutUrl, paymentId: payment.id };
}
