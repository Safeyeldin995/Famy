import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { enabledWebOAuthProviders, signInWithOAuthProvider } from "@/lib/auth/oauth";
import { onlineAuthCallbackUrl } from "@/lib/auth/onlineWebAuth";
import { stashOnlineWebReturnTo } from "@/lib/web/onlineWebReturnTo";

export function OnlineAuthCard({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-md space-y-6 rounded-3xl bg-white p-6 shadow-sm sm:p-8">{children}</div>;
}

export function OnlineAuthDivider({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-pro-12 font-semibold text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {label ?? null}
      {label ? <span className="h-px flex-1 bg-border" /> : null}
    </div>
  );
}

const FIELD_CLASS =
  "flex h-14 items-center rounded-2xl border border-border/80 bg-surface transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15";

export function OnlineTextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  ltr,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email";
  autoComplete?: string;
  placeholder?: string;
  ltr?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-pro-13 font-bold text-muted-foreground">
        {label}
      </label>
      <div className={FIELD_CLASS}>
        <input
          id={id}
          type={type}
          dir={ltr ? "ltr" : undefined}
          inputMode={type === "email" ? "email" : undefined}
          autoCapitalize={type === "email" ? "none" : undefined}
          spellCheck={type === "email" ? false : undefined}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-11 min-w-0 flex-1 bg-transparent px-4 text-start text-[16px] font-semibold text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground/60"
        />
      </div>
    </div>
  );
}

export function OnlinePasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  hint?: string;
}) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-pro-13 font-bold text-muted-foreground">
        {label}
      </label>
      <div className={`${FIELD_CLASS} gap-2 ps-4 pe-1.5`}>
        <input
          id={id}
          type={show ? "text" : "password"}
          dir="ltr"
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-11 min-w-0 flex-1 bg-transparent text-start text-[16px] font-semibold text-foreground outline-none"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? t("auth.hidePassword") : t("auth.showPassword")}
          className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground"
        >
          {show ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
        </button>
      </div>
      {hint ? <p className="text-pro-12 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

/** "Continue with Google" for students, shown only when Google is enabled for the website. */
export function OnlineGoogleButton({ returnTo }: { returnTo: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (!enabledWebOAuthProviders().includes("google")) return null;
  return (
    <div className="space-y-4">
      <OnlineAuthDivider label={t("oauth.or")} />
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          stashOnlineWebReturnTo(returnTo);
          const { error } = await signInWithOAuthProvider(
            "google",
            onlineAuthCallbackUrl(window.location.origin),
          );
          if (error) {
            setBusy(false);
            toast.error(t("oauth.failedBody"));
          }
        }}
        className="focus-ring flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-border bg-white text-pro-14 font-extrabold text-foreground disabled:opacity-60"
      >
        <GoogleMark />
        {busy ? t("oauth.redirectingGoogle") : t("oauth.continueWithGoogle")}
      </button>
    </div>
  );
}
