import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { OTP_LENGTH, applyOtpBackspace, applyOtpDigitInput } from "./otpCodeInputLogic";

type OtpCodeInputProps = {
  value: string[];
  onChange: (next: string[]) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
};

export function OtpCodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
}: OtpCodeInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const groupId = useId();
  const { t } = useTranslation();

  const focusAt = (index: number) => {
    refs.current[index]?.focus();
  };

  const handleInput = (index: number, raw: string) => {
    const result = applyOtpDigitInput(value, index, raw);
    onChange(result.next);
    focusAt(result.focusIndex);
    if (result.complete) {
      onComplete?.(result.next.join(""));
    }
  };

  return (
    <div
      className="mt-8 flex justify-center gap-2"
      dir="ltr"
      role="group"
      aria-labelledby={`${groupId}-label`}
    >
      <span id={`${groupId}-label`} className="sr-only">
        {t("auth.otpInputLabel", "Six-digit verification code")}
      </span>
      {value.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          data-testid={index === 0 ? "otp-input" : undefined}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={t("auth.otpDigitLabel", {
            defaultValue: "Digit {{position}} of {{total}}",
            position: index + 1,
            total: OTP_LENGTH,
          })}
          maxLength={OTP_LENGTH}
          value={digit}
          disabled={disabled}
          onChange={(event) => handleInput(index, event.target.value)}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (/\d/.test(text)) {
              event.preventDefault();
              handleInput(index, text);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace") {
              const result = applyOtpBackspace(value, index);
              onChange(result.next);
              focusAt(result.focusIndex);
            }
          }}
          aria-invalid={invalid || undefined}
          className={`h-14 w-0 min-w-0 max-w-[3.25rem] flex-1 rounded-2xl border-2 bg-surface-2 text-center text-2xl font-extrabold outline-none transition-all focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10 ${
            invalid
              ? "border-destructive/60 text-destructive"
              : digit
                ? "border-brand bg-white text-foreground"
                : "border-transparent"
          } disabled:opacity-50`}
        />
      ))}
    </div>
  );
}
