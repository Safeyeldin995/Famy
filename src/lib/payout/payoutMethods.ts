/**
 * Provider payout methods: where Famy sends a provider's money.
 * Pure helpers shared by the provider app, the provider website and the admin panel.
 * Server-side CHECK constraints in provider_payout_methods enforce the same rules.
 */

export const PAYOUT_METHODS = [
  "instapay",
  "vodafone_cash",
  "etisalat_cash",
  "orange_cash",
  "bank",
] as const;

export type PayoutMethodKind = (typeof PAYOUT_METHODS)[number];

export type PayoutMethodRow = {
  id: string;
  provider_id: string;
  method: string;
  holder_name: string;
  bank_name: string | null;
  account_number: string | null;
  wallet_phone: string | null;
  instapay_address: string | null;
  is_default: boolean;
  created_at?: string;
};

export type PayoutMethodDraft = {
  method: PayoutMethodKind;
  holderName: string;
  bankName: string;
  accountNumber: string;
  walletPhone: string;
  instapayAddress: string;
};

export type PayoutMethodInsert = {
  provider_id: string;
  method: PayoutMethodKind;
  holder_name: string;
  bank_name: string | null;
  account_number: string | null;
  wallet_phone: string | null;
  instapay_address: string | null;
  is_default: boolean;
};

export type PayoutFieldError =
  "holderName" | "bankName" | "accountNumber" | "walletPhone" | "instapayAddress";

export const isWalletMethod = (m: string) =>
  m === "vodafone_cash" || m === "etisalat_cash" || m === "orange_cash";

export function isPayoutMethodKind(m: string): m is PayoutMethodKind {
  return (PAYOUT_METHODS as readonly string[]).includes(m);
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/** Arabic-Indic digits to Latin, then keep digits only. */
export function normalizeDigits(v: string) {
  return v.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10)).replace(/\D/g, "");
}

/** Egyptian mobile number: 01[0125] + 8 digits; accepts +20 / 0020 prefixes. */
export function normalizeEgyptMobile(v: string): string | null {
  let d = normalizeDigits(v);
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith("1")) d = `0${d}`;
  return /^01[0125]\d{8}$/.test(d) ? d : null;
}

/** InstaPay address: "name@instapay" or a mobile number linked to InstaPay. */
export function normalizeInstapayAddress(v: string): string | null {
  const t = v.trim().toLowerCase().replace(/\s+/g, "");
  if (/^[a-z0-9._-]{2,64}@instapay$/.test(t)) return t;
  if (/^[a-z0-9._-]{2,64}$/.test(t) && /[a-z]/.test(t)) return `${t}@instapay`;
  return normalizeEgyptMobile(t);
}

/** Bank account number or IBAN: letters and digits only, 6-34 characters. */
export function normalizeAccountNumber(v: string): string | null {
  const t = v
    .replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10))
    .replace(/[\s-]/g, "")
    .toUpperCase();
  return /^[A-Z0-9]{6,34}$/.test(t) ? t : null;
}

export function emptyPayoutDraft(method: PayoutMethodKind = "instapay"): PayoutMethodDraft {
  return {
    method,
    holderName: "",
    bankName: "",
    accountNumber: "",
    walletPhone: "",
    instapayAddress: "",
  };
}

/** Validates a draft and returns the row to insert, or the fields that need fixing. */
export function buildPayoutInsert(
  providerId: string,
  draft: PayoutMethodDraft,
  isDefault: boolean,
): { ok: true; row: PayoutMethodInsert } | { ok: false; errors: PayoutFieldError[] } {
  const errors: PayoutFieldError[] = [];
  const holder = draft.holderName.trim().replace(/\s+/g, " ");
  if (holder.length < 2 || holder.length > 120) errors.push("holderName");

  let bank_name: string | null = null;
  let account_number: string | null = null;
  let wallet_phone: string | null = null;
  let instapay_address: string | null = null;

  if (draft.method === "bank") {
    bank_name = draft.bankName.trim() || null;
    if (!bank_name || bank_name.length < 2 || bank_name.length > 120) errors.push("bankName");
    account_number = normalizeAccountNumber(draft.accountNumber);
    if (!account_number) errors.push("accountNumber");
  } else if (draft.method === "instapay") {
    instapay_address = normalizeInstapayAddress(draft.instapayAddress);
    if (!instapay_address) errors.push("instapayAddress");
  } else {
    wallet_phone = normalizeEgyptMobile(draft.walletPhone);
    if (!wallet_phone) errors.push("walletPhone");
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    row: {
      provider_id: providerId,
      method: draft.method,
      holder_name: holder,
      bank_name,
      account_number,
      wallet_phone,
      instapay_address,
      is_default: isDefault,
    },
  };
}

/** The value admin copies when sending money (number, account or InstaPay address). */
export function payoutDestination(row: PayoutMethodRow): string {
  if (row.method === "bank") return row.account_number ?? "";
  if (row.method === "instapay") return row.instapay_address ?? "";
  return row.wallet_phone ?? "";
}

/** Default first, then oldest first. */
export function sortPayoutMethods<T extends PayoutMethodRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? "") || 0;
  });
}

/** Read the customer-facing InstaPay details from a payment method's public_config. */
export function instapayConfig(config: unknown): { handle: string; payLink: string; note: string } {
  const c = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const handle = typeof c.handle === "string" ? c.handle.trim() : "";
  const link = typeof c.pay_link === "string" ? c.pay_link.trim() : "";
  const note = typeof c.note === "string" ? c.note.trim() : "";
  return { handle, payLink: /^https:\/\/\S+$/.test(link) ? link : "", note };
}
