import { useTranslation } from "react-i18next";
import { normalizeDigitsToWestern } from "@/lib/otp/normalizePhone";

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
};

/**
 * Egyptian mobile input for the website. Phone numbers are always written
 * left to right, so the whole field is LTR even in Arabic: "+20" sits on the
 * left and the number is typed right after it, in Western digits.
 */
export function PhoneNumberField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled,
  autoFocus,
  onEnter,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-pro-13 font-bold text-muted-foreground">
        {label}
      </label>
      <div
        dir="ltr"
        className="flex h-14 items-center gap-2 rounded-2xl border border-border/80 bg-surface px-3 transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15"
      >
        <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-surface-2 px-2.5 text-pro-14 font-extrabold text-foreground">
          <span aria-hidden="true">🇪🇬</span>
          <span>+20</span>
        </span>
        <input
          id={id}
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder ?? t("auth.phonePlaceholder")}
          value={value}
          onChange={(e) => onChange(normalizeDigitsToWestern(e.target.value).replace(/[^\d ]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) onEnter();
          }}
          className="min-h-11 min-w-0 flex-1 bg-transparent px-1 text-start text-[16px] font-bold tracking-wide text-foreground outline-none placeholder:font-semibold placeholder:text-muted-foreground/50 disabled:opacity-70"
        />
      </div>
      {hint ? <p className="text-pro-12 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
