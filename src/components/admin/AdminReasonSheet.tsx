import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";

export function AdminReasonSheet({
  title,
  description,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      dismissible={!busy}
    >
      <DrawerContent className="mx-auto max-h-[90dvh] max-w-lg overflow-y-auto">
        <DrawerHeader className="text-start sm:text-start">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <label className="mx-4 text-sm font-semibold">
          {t("adminReview.reason")}
          <textarea
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-xl border border-border bg-surface p-3 text-sm"
          />
        </label>
        <DrawerFooter className="flex-row">
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className="focus-ring min-h-11 flex-1 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground disabled:opacity-50"
          >
            {t("common.confirm")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="focus-ring min-h-11 flex-1 rounded-xl border border-border px-4 text-sm font-bold disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
