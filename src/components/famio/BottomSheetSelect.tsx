import { useState, type ReactNode } from "react";
import { Drawer } from "vaul";
import { Command } from "cmdk";
import { ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./providerApply.css";
export function BottomSheetSelect({
  label,
  value,
  options,
  onChange,
  trigger,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  trigger?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { t, i18n } = useTranslation();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={trigger ? "apply-value" : "w-full text-start"}
          aria-label={label}
        >
          {trigger ?? (
            <>
              <span className="apply-label">{label}</span>
              <span className="apply-input">
                {options.find((o) => o.value === value)?.label ?? t("common.select")}
                <ChevronDown size={18} />
              </span>
            </>
          )}
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-[rgba(15,13,16,.42)]" />
        <Drawer.Content
          className="apply-ui apply-sheet"
          dir={i18n.dir()}
          aria-describedby={undefined}
        >
          <div className="apply-grab" />
          <div className="flex items-center justify-between">
            <Drawer.Title className="text-[18px] font-extrabold">{label}</Drawer.Title>
            <Drawer.Close className="apply-back" aria-label={t("common.close")}>
              <X size={18} />
            </Drawer.Close>
          </div>
          <Command>
            <Command.Input
              aria-label={t("common.search")}
              placeholder={t("common.search")}
              className={options.length > 7 ? "apply-input mb-3" : "sr-only"}
            />
            <Command.List className="max-h-[50dvh] overflow-y-auto">
              <Command.Empty>{t("providerApply.noOptions")}</Command.Empty>
              {options.map((option) => (
                <Command.Item
                  key={option.value}
                  value={option.label}
                  className={`apply-option ${value === option.value ? "font-extrabold" : ""}`}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                  <span
                    aria-hidden="true"
                    className={`apply-radio ${value === option.value ? "on" : ""}`}
                  />
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
