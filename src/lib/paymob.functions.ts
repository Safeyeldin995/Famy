import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestBearerUserId } from "@/lib/auth/requestAuth.server";
import type { SupabaseAdminClient } from "@/lib/paymob/paymobCheckout.server";

const CreatePaymobCheckoutSchema = z.object({
  bookingId: z.string().uuid(),
  paymentId: z.string().uuid().optional(),
});

export const createPaymobCheckoutFn = createServerFn({ method: "POST" })
  .validator((data) => CreatePaymobCheckoutSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await getRequestBearerUserId();
    if (!userId) throw new Error("Unauthorized");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createPaymobCheckoutForPayment } = await import("@/lib/paymob/paymobCheckout.server");

    return createPaymobCheckoutForPayment({
      supabaseAdmin: supabaseAdmin as unknown as SupabaseAdminClient,
      userId,
      bookingId: data.bookingId,
      paymentId: data.paymentId,
    });
  });

export const getPaymobIntegrationStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const { isPaymobConfigured } = await import("@/lib/paymob/paymobConfig.server");
  return { configured: isPaymobConfigured() };
});
