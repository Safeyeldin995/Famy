export type AccountDeletionCheck = {
  ok: boolean;
  reason?:
    | "active_bookings"
    | "unpaid_balance"
    | "funds_owed_to_user"
    | "admin"
    | "not_authenticated";
};

export type StoragePathRef = { bucket: string; path: string };
