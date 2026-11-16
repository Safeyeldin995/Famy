import { createFileRoute } from "@tanstack/react-router";
import { PaymobAppReturn } from "@/components/site/PaymobAppReturn";

/** Paymob returns here after a customer pays unpaid cancellation fees. */
export const Route = createFileRoute("/pay/fees-return")({
  component: () => <PaymobAppReturn deepLink="famy://home" />,
});
