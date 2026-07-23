import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  OTP_LENGTH,
  applyOtpBackspace,
  applyOtpDigitInput,
} from "./otpCodeInputLogic";

type OtpCodeInputProps = {
  value: string[];
  onChange: (next: string[]) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
};

export function OtpCodeInput({ value, onChange, onComplete, disabled }: OtpCodeInputProps) {
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
    <div className="mt-10 flex justify-between gap-2" dir="ltr" role="group" aria-labelledby={`${groupId}-label`}>
      <span id={`${groupId}-label`} className="sr-only">
        {t("auth.otpInputLabel", "Six-digit verification code")}
      </span>
      {value.map((digit, index) => (
        <input
          key={index}
          ref={(el) => { refs.current[index] = el; }}
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
          className={`h-14 w-12 rounded-2xl border-2 bg-surface text-center text-2xl font-extrabold outline-none transition-all ${
            digit ? "border-navy text-navy" : "border-border"
          } disabled:opacity-50`}
        />
      ))}
    </div>
  );
}
