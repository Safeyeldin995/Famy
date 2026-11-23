import { readPaymobConfig } from "./paymobConfig.server";

export class PaymobRefundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymobRefundError";
  }
}

export async function refundPaymobTransaction(input: {
  transactionId: number;
  amountCents: number;
}): Promise<{ reference: string }> {
  const config = readPaymobConfig();
  const response = await fetch(`${config.baseUrl}/api/acceptance/void_refund/refund`, {
    method: "POST",
    headers: {
      Authorization: `Token ${config.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction_id: input.transactionId,
      amount_cents: input.amountCents,
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    throw new PaymobRefundError(
      `Paymob refund failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const body = (await response.json()) as { id?: number | string; transaction_id?: number | string };
  const reference = String(body.id ?? body.transaction_id ?? input.transactionId);
  return { reference };
}