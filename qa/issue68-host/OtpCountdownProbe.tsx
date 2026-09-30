import { useTranslation } from "react-i18next";
import { formatOtpExpiryClock, formatOtpSecondsDuration } from "@/lib/auth/otpCountdown";

/** Issue68-only: OTP countdown copy without pulling OtpService / server OTP modules into the browser bundle. */
export function OtpCountdownProbe() {
  const { t, i18n } = useTranslation();
  const resendAvailableIn = 28;
  const otpExpiresIn = 300;

  return (
    <div data-testid="issue68-otp-ui-probe" dir={i18n.dir()}>
      <p className="text-sm font-semibold text-muted-foreground">
        {t("auth.codeExpiresIn", "Code expires in")}{" "}
        <span className="font-black text-foreground">{formatOtpExpiryClock(otpExpiresIn)}</span>
      </p>
      <p className="mt-2 text-sm font-semibold text-muted-foreground">
        {t("auth.resendIn")}{" "}
        <span className="font-black text-foreground">
          {formatOtpSecondsDuration(resendAvailableIn, t)}
        </span>
      </p>
    </div>
  );
}
