import { createFileRoute } from "@tanstack/react-router";
import { Route as PromoCodesRoute } from "./promo-codes";

const PromoCodes = PromoCodesRoute.options.component!;

export const Route = createFileRoute("/preview/promo-codes")({ component: PromoCodes });
