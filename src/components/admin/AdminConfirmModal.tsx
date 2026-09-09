import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AdminDangerButton, AdminPrimaryButton, AdminSecondaryButton } from "./AdminButtons";

export function AdminConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-border/60 bg-surface p-5 shadow-lg">
        <h2 className="text-base font-extrabold text-foreground">{title}</h2>
        {body ? <p className="mt-2 text-sm font-medium text-muted-foreground">{body}</p> : null}
        {children}
        <div className="mt-5 flex justify-end gap-2">
          <AdminSecondaryButton onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t("common.cancel")}
          </AdminSecondaryButton>
          {destructive ? (
            <AdminDangerButton onClick={onConfirm} disabled={busy}>
              {confirmLabel ?? t("common.confirm")}
            </AdminDangerButton>
          ) : (
            <AdminPrimaryButton onClick={onConfirm} disabled={busy}>
              {confirmLabel ?? t("common.confirm")}
            </AdminPrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}
