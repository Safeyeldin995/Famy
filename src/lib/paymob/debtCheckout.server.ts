import { readPaymobConfig } from "./paymobConfig.server";
import { createPaymobIntention } from "./paymobApi.server";
import { defaultBillingFromProfile, type SupabaseAdminClient } from "./paymobCheckout.server";

/** Where Paymob sends the customer after paying fees; the page hands them back to the app. */
export function buildDebtReturnUrl(appOrigin: string): string {
  return new URL("/pay/fees-return", appOrigin).toString();
}

/**
 * Card payment for a customer's unpaid cancellation fees. The settlement (amount = all
 * open debts) is created in the database first; the verified Paymob webhook settles it.
 */
export async function createDebtCheckout(input: {
  supabaseAdmin: SupabaseAdminClient;
  userId: string;
}): Promise<{ checkoutUrl: string; settlementId: string; amount: number }> {
  const config = readPaymobConfig();

  const { data: sid, error: openErr } = await input.supabaseAdmin.rpc("open_debt_settlement_for", {
    p_customer_id: input.userId,
    p_method: "card",
  });
  if (openErr || typeof sid !== "string") {
    throw new Error(openErr?.message ?? "Could not open the fee payment.");
  }

  const { data: row, error: rowErr } = await input.supabaseAdmin
    .from("customer_debt_settlements")
    .select("amount, currency")
    .eq("id", sid)
    .single();
  if (rowErr || !row) throw new Error("Could not read the fee payment.");
  const amount = Number((row as { amount: number }).amount);
  const currency = String((row as { currency: string | null }).currency || "EGP").toUpperCase();
  const amountCents = Math.round(amount * 100);

  const { data: profile } = await input.supabaseAdmin
    .from("profiles")
    .select("full_name, phone")
    .eq("id", input.userId)
    .maybeSingle();
  const billing = defaultBillingFromProfile(
    profile as { full_name: string | null; phone: string | null } | null,
  );

  const intention = await createPaymobIntention(config, {
    amountCents,
    currency,
    specialReference: `fees-${sid}`,
    notificationUrl: config.notificationUrl,
    redirectionUrl: buildDebtReturnUrl(config.appOrigin),
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
        name: "Famy cancellation fees",
        amount: amountCents,
        description: "Unpaid cancellation fees",
        quantity: 1,
      },
    ],
  });

  const { error: attachErr } = await input.supabaseAdmin.rpc("debt_settlement_attach_paymob", {
    p_settlement_id: sid,
    p_customer_id: input.userId,
    p_order_id: intention.orderId,
    p_integration_id: config.integrationId,
  });
  if (attachErr) throw new Error("Could not save the fee payment.");

  return { checkoutUrl: intention.checkoutUrl, settlementId: sid, amount };
}
