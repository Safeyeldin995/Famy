import {
  buildPaymobUnifiedCheckoutUrl,
  type PaymobConfig,
} from "./paymobConfig.server";

export type PaymobBillingData = {
  first_name: string;
  last_name: string;
  phone_number: string;
  email: string;
  street: string;
  building: string;
  floor: string;
  apartment: string;
  city: string;
  country: string;
  state: string;
};

export type CreatePaymobIntentionInput = {
  amountCents: number;
  currency: string;
  specialReference: string;
  billingData: PaymobBillingData;
  notificationUrl: string;
  redirectionUrl: string;
  items: Array<{ name: string; amount: number; description?: string; quantity?: number }>;
};

export type PaymobIntentionResponse = {
  id: string;
  client_secret: string;
  intention_order_id?: number;
  status?: string;
};

/**
 * The request never got a response from Paymob (network error, timeout,
 * connection reset). Paymob may or may not have created the intention —
 * callers must not treat this the same as a clean rejection (which proves
 * nothing was created): don't release a checkout reservation on this error,
 * only on PaymobIntentionRejectedError below.
 */
export class PaymobIntentionIndeterminateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PaymobIntentionIndeterminateError";
  }
}

/** Paymob received the request and explicitly rejected or malformed-responded to it — no intention was created. */
export class PaymobIntentionRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymobIntentionRejectedError";
  }
}

export async function createPaymobIntention(
  config: PaymobConfig,
  input: CreatePaymobIntentionInput,
): Promise<{ checkoutUrl: string; intentionId: string; clientSecret: string }> {
  const body = {
    amount: input.amountCents,
    currency: input.currency,
    payment_methods: [config.integrationId],
    items: input.items,
    billing_data: input.billingData,
    special_reference: input.specialReference,
    notification_url: input.notificationUrl,
    redirection_url: input.redirectionUrl,
    extras: {
      payment_id: input.specialReference,
    },
  };

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/v1/intention/`, {
      method: "POST",
      headers: {
        Authorization: `Token ${config.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new PaymobIntentionIndeterminateError("Could not reach Paymob to start checkout.", { cause: err });
  }

  if (!response.ok) {
    const detail = await response.text();
    console.error("[paymob.intention] create failed", response.status, detail.slice(0, 500));
    throw new PaymobIntentionRejectedError("Could not start Paymob checkout.");
  }

  // A 2xx response proves Paymob accepted and processed the request — it does
  // NOT prove no intention was created if we then fail to read the confirmation.
  // Both cases below are indeterminate, not a proven rejection.
  let data: PaymobIntentionResponse;
  try {
    data = (await response.json()) as PaymobIntentionResponse;
  } catch (err) {
    throw new PaymobIntentionIndeterminateError("Paymob checkout response could not be parsed.", { cause: err });
  }
  if (!data.client_secret || !data.id) {
    throw new PaymobIntentionIndeterminateError("Paymob checkout response was incomplete.");
  }

  return {
    checkoutUrl: buildPaymobUnifiedCheckoutUrl(config.publicKey, data.client_secret, config.baseUrl),
    intentionId: String(data.id),
    clientSecret: data.client_secret,
  };
}
