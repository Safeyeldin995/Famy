import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { adminControl } from "./operations";

export const catalogScreen =
  "space-y-4 px-4 py-5 text-sm [overflow-wrap:anywhere] [&_button]:min-h-11 [&_button]:min-w-11 [&_input:not([type=checkbox])]:min-h-11 [&_select]:min-h-11 [&_summary]:min-h-11 [&_summary]:content-center [&_label]:min-w-0";

export function CatalogSheet({
  title,
  description,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Drawer
      open
      dismissible={!busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DrawerContent className="mx-auto max-h-[90dvh] max-w-2xl overflow-hidden text-sm [&_button]:min-h-11 [&_input:not([type=checkbox])]:min-h-11 [&_select]:min-h-11">
        <div data-vaul-no-drag className="min-h-0 overflow-y-auto px-4 pb-6">
          <DrawerHeader className="text-start sm:text-start">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          {children}
          <DrawerFooter>
            <button type="button" disabled={busy} className={adminControl} onClick={onClose}>
              {t("common.cancel")}
            </button>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function CatalogConfirm({
  title,
  description,
  onConfirm,
  onClose,
  busy = false,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <CatalogSheet title={title} description={description} onClose={onClose} busy={busy}>
      <button
        type="button"
        disabled={busy}
        onClick={onConfirm}
        className={`${adminControl} bg-brand text-brand-foreground`}
      >
        {busy ? t("common.saving") : t("common.confirm")}
      </button>
    </CatalogSheet>
  );
}

/** Confirmation owns no mutation; existing hooks retain all authorization and validation. */
export function ConfirmCatalogButton({
  children,
  description,
  onConfirm,
  disabled,
  className = adminControl,
}: {
  children: ReactNode;
  description: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" disabled={disabled} className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && (
        <CatalogConfirm
          title={t("adminCatalog.confirmTitle")}
          description={description}
          busy={disabled}
          onClose={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            onConfirm();
          }}
        />
      )}
    </>
  );
}

export function catalogName(
  row: { name_ar?: string | null; name_en?: string | null },
  language: string,
) {
  return (
    (language.startsWith("ar") ? row.name_ar : row.name_en) || row.name_ar || row.name_en || "—"
  );
}
export function catalogDate(value: string | null | undefined, language: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(value))
    : "—";
}
export function catalogTime(value: string, language: string) {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "—";
  const d = new Date(2000, 0, 1, h, m);
  return new Intl.DateTimeFormat(language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB", {
    hour: "numeric",
    minute: m ? "2-digit" : undefined,
    hour12: true,
  }).format(d);
}
export function packageEnd(start: string, minutes: number) {
  const [h, m] = start.split(":").map(Number);
  const total = (h * 60 + m + minutes) % 1440;
  return `${Math.floor(total / 60)
    .toString()
    .padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}
