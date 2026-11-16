export type AccountDeletionCheck = {
  ok: boolean;
  reason?: "active_bookings" | "unpaid_balance" | "admin" | "not_authenticated";
};

export type StoragePathRef = { bucket: string; path: string };
