import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHmac, webcrypto } from "node:crypto";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { buildPaymobTransactionHmacPayload } from "../paymobTransactionHmac";

// Execute the real Edge handler with an in-memory DB boundary. No credentials
// or network calls are used. HMACs are computed before adversarial edits.
function harness() {
  let handler!: (req: Request) => Promise<Response>;
  const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
  const source = readFileSync("supabase/functions/paymob-webhook/index.ts", "utf8").replace(
    /import \{ createClient \} from .*?;/,
    "",
  );
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText,
    {
      Deno: {
        env: { get: () => "test-secret" },
        serve: (fn: typeof handler) => {
          handler = fn;
        },
      },
      crypto: webcrypto,
      TextEncoder,
      Request,
      Response,
      URL,
      console,
      createClient: () => ({ rpc }),
    },
  );
  const obj = {
    amount_cents: 10000,
    created_at: "2026-10-19",
    currency: "EGP",
    error_occured: false,
    has_parent_transaction: false,
    id: 123,
    integration_id: 456,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 789 },
    owner: 1,
    pending: false,
    source_data: { pan: "1234", sub_type: "Visa", type: "card" },
    success: true,
    merchant_order_id: "original-payment",
  };
  const sign = () =>
    createHmac("sha512", "test-secret")
      .update(buildPaymobTransactionHmacPayload(obj))
      .digest("hex");
  const send = (hmac = sign()) =>
    handler(
      new Request(`https://example.test/?hmac=${hmac}`, {
        method: "POST",
        body: JSON.stringify({ type: "TRANSACTION", obj }),
      }),
    );
  return { rpc, obj, sign, send };
}

describe("Paymob webhook security", () => {
  it("ignores an altered unsigned merchant reference and resolves only the signed order", async () => {
    const h = harness();
    const signature = h.sign();
    h.obj.merchant_order_id = "attacker-selected-payment";
    expect((await h.send(signature)).status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith(
      "paymob_apply_transaction_webhook",
      expect.objectContaining({
        p_order_id: 789,
        p_integration_id: 456,
        p_currency: "EGP",
        p_amount_cents: 10000,
      }),
    );
    expect(h.rpc.mock.calls[0]).not.toContainEqual(
      expect.objectContaining({ p_payment_id: expect.anything() }),
    );
  });

  it("rejects tampering with the signed order", async () => {
    const h = harness();
    const signature = h.sign();
    h.obj.order.id = 999;
    expect((await h.send(signature)).status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each(["is_auth", "is_refunded", "is_voided"] as const)(
    "does not capture a transaction with %s",
    async (flag) => {
      const h = harness();
      h.obj[flag] = true;
      expect((await h.send()).status).toBe(200);
      expect(h.rpc).not.toHaveBeenCalled();
    },
  );

  it("records an errored final transaction as failure, never capture", async () => {
    const h = harness();
    h.obj.error_occured = true;
    await h.send();
    expect(h.rpc).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ p_success: false }),
    );
  });

  it("forwards both pending and final events for database state progression", async () => {
    const h = harness();
    h.obj.pending = true;
    await h.send();
    h.obj.pending = false;
    await h.send();
    expect(h.rpc).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({ p_pending: true }),
    );
    expect(h.rpc).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ p_pending: false, p_success: true }),
    );
  });
});
