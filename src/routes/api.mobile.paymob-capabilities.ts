import { createFileRoute } from "@tanstack/react-router";
import { readPaymobWalletCapabilities } from "@/lib/paymob/paymobConfig.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Public flags for whether Paymob wallet integrations are configured server-side. */
export const Route = createFileRoute("/api/mobile/paymob-capabilities")({
  server: {
    handlers: {
      GET: async () => {
        const capabilities = readPaymobWalletCapabilities();
        return json({ ok: true, ...capabilities });
      },
    },
  },
});