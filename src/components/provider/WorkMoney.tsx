import { formatEGP } from "@/lib/format";

/** Keep the currency attached to its amount even in a half-width mobile tile. */
export function WorkMoney({ amount }: { amount: number }) {
  return (
    <span className="block whitespace-nowrap text-pro-22 font-extrabold leading-tight min-[420px]:text-pro-24">
      {formatEGP(amount)}
    </span>
  );
}
