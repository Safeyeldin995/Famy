import { Banknote, CreditCard, Smartphone, Wallet } from "lucide-react";
import paymobLogo from "@/assets/payment/paymob.png";

/**
 * Official card-network marks shown on online (Paymob) payment options.
 * Visa path: Simple Icons (CC0). Mastercard: the standard two-circle symbol.
 * InstaPay has no official artwork in the repo yet, so it uses a neutral icon
 * rather than an invented logo.
 */
export function VisaLogo({ className = "h-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 8 24 8" className={className} role="img" aria-label="Visa">
      <path
        fill="#1A1F71"
        d="M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z"
      />
    </svg>
  );
}

export function MastercardLogo({ className = "h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 20" className={className} role="img" aria-label="Mastercard">
      <circle cx="10" cy="10" r="10" fill="#EB001B" />
      <circle cx="22" cy="10" r="10" fill="#F79E1B" />
      <path fill="#FF5F00" d="M16 2a10 10 0 0 1 0 16a10 10 0 0 1 0-16z" />
    </svg>
  );
}

function BrandChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 w-11 items-center justify-center rounded-md border border-border/70 bg-white">
      {children}
    </span>
  );
}

/** Paymob wordmark (official artwork supplied by the product owner). */
export function PaymobLogo({ className = "h-3.5" }: { className?: string }) {
  return <img src={paymobLogo} alt="Paymob" className={`w-auto ${className}`} />;
}

/** Gateway and accepted card networks, for the online payment option. */
export function CardBrands({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} dir="ltr">
      <span className="inline-flex h-7 items-center rounded-md border border-border/70 bg-white px-2">
        <PaymobLogo className="h-3" />
      </span>
      <BrandChip>
        <VisaLogo className="h-2.5" />
      </BrandChip>
      <BrandChip>
        <MastercardLogo className="h-4" />
      </BrandChip>
    </span>
  );
}

/** Icon tile content for a payment method, keyed by its type and code. */
export function PaymentMethodIcon({
  methodType,
  code,
}: {
  methodType: string | null | undefined;
  code?: string | null;
}) {
  if (methodType === "cash") return <Banknote className="h-5 w-5" aria-hidden="true" />;
  if (methodType === "online") return <CreditCard className="h-5 w-5" aria-hidden="true" />;
  if (code === "instapay") return <Smartphone className="h-5 w-5" aria-hidden="true" />;
  return <Wallet className="h-5 w-5" aria-hidden="true" />;
}
