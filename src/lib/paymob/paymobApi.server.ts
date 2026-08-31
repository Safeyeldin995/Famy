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

  const response = await fetch(`${config.baseUrl}/v1/intention/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${config.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("[paymob.intention] create failed", response.status, detail.slice(0, 500));
    throw new Error("Could not start Paymob checkout.");
  }

  const data = (await response.json()) as PaymobIntentionResponse;
  if (!data.client_secret || !data.id) {
    throw new Error("Paymob checkout response was incomplete.");
  }

  return {
    checkoutUrl: buildPaymobUnifiedCheckoutUrl(config.publicKey, data.client_secret, config.baseUrl),
    intentionId: String(data.id),
    clientSecret: data.client_secret,
  };
}
