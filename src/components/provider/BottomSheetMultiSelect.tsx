import { useState } from "react";
import { Drawer } from "vaul";
import { Check, ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import "@/components/famio/providerApply.css";
export function BottomSheetMultiSelect({
  label,
  summary,
  value,
  options,
  onChange,
}: {
  label: string;
  summary: string;
  value: string[];
  options: { value: string; label: string; locked?: boolean }[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const { t, i18n } = useTranslation();
  const all = options.length > 0 && options.every((option) => value.includes(option.value));
  const checkbox = (text: string, checked: boolean, disabled: boolean, change: () => void) => (
    <label className="apply-option min-h-11 cursor-pointer gap-3">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        disabled={disabled}
        onChange={change}
      />
      <span>{text}</span>
      <span
        aria-hidden="true"
        className={`apply-checkbox peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand ${checked ? "on" : ""}`}
      >
        {checked && <Check size={14} />}
      </span>
    </label>
  );
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <button type="button" className="w-full text-start" aria-label={label}>
          <span className="apply-label">{label}</span>
          <span className="apply-input">
            {summary || t("providerApply.select")}
            <ChevronDown size={18} />
          </span>
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Drawer.Content
          className="apply-ui apply-sheet"
          dir={i18n.dir()}
          aria-describedby={undefined}
        >
          <div className="apply-grab" />
          <div className="flex items-center justify-between">
            <Drawer.Title className="text-lg font-extrabold">{label}</Drawer.Title>
            <Drawer.Close className="apply-back" aria-label={t("providerApply.close")}>
              <X size={18} />
            </Drawer.Close>
          </div>
          {checkbox(t("providerClarity.selectAll"), all, !options.length, () =>
            onChange(
              all
                ? options.filter((option) => option.locked).map((option) => option.value)
                : options.map((option) => option.value),
            ),
          )}
          <div className="max-h-[50dvh] overflow-y-auto">
            {options.map((option) => (
              <div key={option.value}>
                {checkbox(
                  option.label,
                  option.locked || value.includes(option.value),
                  !!option.locked,
                  () =>
                    onChange(
                      value.includes(option.value)
                        ? value.filter((id) => id !== option.value)
                        : [...value, option.value],
                    ),
                )}
              </div>
            ))}
          </div>
          <Drawer.Close className="apply-cta mt-4 w-full">{t("common.done")}</Drawer.Close>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
