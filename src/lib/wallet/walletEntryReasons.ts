/**
 * Every reason allowed by the database check on customer_wallet_entries
 * (latest: 20261126170000_admin_wallet_ops). Each one needs a label in
 * wallet.customer.reason, wallet.reason and onlineWeb.wallet.reason.
 */
export const WALLET_ENTRY_REASONS = [
  "provider_cancelled",
  "customer_cancelled_refund",
  "admin_credit",
  "admin_debit",
  "checkout_spend",
  "checkout_release",
  "paymob_superseded_capture",
  "forfeited_on_deletion",
  "online_no_show_refund",
  "admin_lesson_refund",
] as const;

export type WalletEntryReason = (typeof WALLET_ENTRY_REASONS)[number];
