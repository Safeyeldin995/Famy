import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Briefcase, Eye, EyeOff, User } from "lucide-react";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { PhoneFrame, PrimaryButton } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { otpService, normalizePhone, type Role } from "@/lib/otp/OtpService";
import { normalizeDigitsToWestern } from "@/lib/otp/normalizePhone";
import { startPhoneOtpFlow, phoneOtpFlowErrorMessage } from "@/lib/otp/phoneOtpFlow";
import {
  resolvePostPasswordLoginTarget,
  resolveRoleLandingForCurrentUser,
} from "@/lib/auth/landing";
import { useCustomerPreviewPath } from "@/components/famio/useCustomerPreviewPath";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { signInWithOAuthProvider } from "@/lib/auth/oauth";

export const Route = createFileRoute("/login")({ component: Login });

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

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: {
    value: T;
    label: string;
    icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  }[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1"
    >
      {options.map((option) => {
        const active = value === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`focus-ring flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-pro-14 font-extrabold transition-all ${
              active ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            {Icon ? (
              <Icon
                className={`h-4 w-4 ${active ? "text-brand" : ""}`}
                strokeWidth={ICON_STROKE_BOLD}
              />
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Login({ previewMode = false }: { previewMode?: boolean } = {}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<Role>("customer");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const nav = useNavigate();
  const { setProfile, setAuthed } = useApp();
  const { t, i18n } = useTranslation();
  const previewPath = useCustomerPreviewPath();

  const phoneValid = normalizeDigitsToWestern(phone).replace(/\D/g, "").length >= 9;
  const screenTitle = mode === "signin" ? t("auth.signIn") : t("auth.signUp");

  const submit = async () => {
    if (previewMode || loading) return;
    setErrorMsg(null);
    const e164 = normalizePhone(phone);
    if (!phoneValid) return;

    if (mode === "signin") {
      if (password.length < 1) return;
      setLoading(true);
      const res = await otpService.signInWithPassword(e164, password);
      setLoading(false);
      if (!res.ok) {
        const m = t("auth.invalidCredentials");
        setErrorMsg(m);
        toast.error(m);
        return;
      }
      setProfile({ phone: e164 });
      setAuthed(true);
      const roleLanding = await resolveRoleLandingForCurrentUser();
      const target = resolvePostPasswordLoginTarget({
        loginRole: role,
        landing: roleLanding?.landing ?? null,
        hasProviderRole: roleLanding?.hasProviderRole ?? false,
      });
      if (target === "provider_account_missing") {
        const m = t(
          "auth.noProviderAccount",
          "This number has no provider account. Sign up as a provider first.",
        );
        setErrorMsg(m);
        toast.error(m);
        return;
      }
      if (target) {
        nav({ to: target });
      }
      return;
    }

    setLoading(true);
    const send = await startPhoneOtpFlow(e164, "signup", role, { languageCode: i18n.language });
    if (!send.ok) {
      setLoading(false);
      const m = phoneOtpFlowErrorMessage(send.error, t, send.retryAfter, send.firebaseAuthCode);
      setErrorMsg(m);
      toast.error(m, { duration: 8000 });
      return;
    }
    setProfile({ phone: e164 });
    setLoading(false);
    nav({ to: "/otp" });
  };

  const fieldClass =
    "flex h-14 items-center rounded-2xl border border-border/80 bg-white transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15";

  return (
    <PhoneFrame bg="bg-white">
      <div className="relative flex flex-1 flex-col overflow-y-auto">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-brand/10 via-brand/[0.04] to-transparent"
        />
        <header className="safe-top relative flex items-center justify-between gap-3 px-6 pt-4">
          <FamyWordmark size="compact" className="!h-9 max-w-[7.5rem]" />
          <LanguageToggle />
        </header>

        <div className="relative flex flex-1 flex-col px-6 pb-8">
          <div className="pt-10">
            <h1 className="text-[1.875rem] font-extrabold leading-tight text-foreground text-balance">
              {mode === "signin" ? t("auth.welcomeBack") : t("auth.signUpTitle")}
            </h1>
            <p className="mt-2 text-pro-14 font-medium leading-relaxed text-muted-foreground">
              {mode === "signin" ? t("auth.signInSubtitle") : t("auth.signUpSubtitle")}
            </p>
          </div>

          <div className="mt-7">
            <Segmented
              value={mode}
              onChange={(next) => {
                setMode(next);
                setErrorMsg(null);
              }}
              label={screenTitle}
              options={[
                { value: "signin", label: t("auth.signIn") },
                { value: "signup", label: t("auth.signUp") },
              ]}
            />
          </div>

          <section className="mt-6 space-y-5">
            <div>
              <p className="mb-2 text-pro-13 font-bold text-muted-foreground">{t("auth.iAmA")}</p>
              <Segmented
                value={role}
                onChange={setRole}
                label={t("auth.iAmA")}
                options={[
                  { value: "customer", label: t("auth.roleCustomer"), icon: User },
                  { value: "provider", label: t("auth.roleProvider"), icon: Briefcase },
                ]}
              />
              {mode === "signup" && role === "provider" ? (
                <p className="mt-3 rounded-2xl bg-brand/[0.06] px-4 py-3 text-pro-12 font-semibold leading-relaxed text-foreground/80">
                  {t("auth.providerNote")}
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor="login-phone"
                className="mb-2 block text-pro-13 font-bold text-muted-foreground"
              >
                {t("auth.phoneNumber")}
              </label>
              <div dir="ltr" className={`${fieldClass} gap-2 px-3`}>
                <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-surface-2 px-2.5 text-pro-14 font-extrabold text-foreground">
                  <span aria-hidden="true">🇪🇬</span>
                  <span>+20</span>
                </span>
                <input
                  id="login-phone"
                  inputMode="tel"
                  dir="ltr"
                  autoComplete="tel"
                  placeholder={t("auth.phonePlaceholder")}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ""))}
                  className="min-h-11 min-w-0 flex-1 bg-transparent px-1 text-[16px] font-bold tracking-wide outline-none placeholder:font-semibold placeholder:text-muted-foreground/50"
                />
              </div>
            </div>

            {mode === "signin" ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label
                    htmlFor="login-password"
                    className="text-pro-13 font-bold text-muted-foreground"
                  >
                    {t("auth.password")}
                  </label>
                  <Link
                    to={previewPath("/auth/forgot")}
                    className="inline-flex min-h-11 items-center text-pro-13 font-extrabold text-brand"
                  >
                    {t("auth.forgot")}
                  </Link>
                </div>
                <div className={`${fieldClass} gap-2 ps-4 pe-1.5`}>
                  <input
                    id="login-password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submit();
                    }}
                    className="min-h-11 min-w-0 flex-1 bg-transparent text-[16px] font-bold outline-none placeholder:text-muted-foreground/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? t("auth.hidePassword") : t("auth.showPassword")}
                    className="focus-ring tap-scale grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground"
                  >
                    {showPw ? (
                      <EyeOff className="h-5 w-5" strokeWidth={ICON_STROKE} />
                    ) : (
                      <Eye className="h-5 w-5" strokeWidth={ICON_STROKE} />
                    )}
                  </button>
                </div>
              </div>
            ) : null}

            {errorMsg ? (
              <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-pro-13 font-bold text-destructive">
                {errorMsg}
              </p>
            ) : null}
          </section>

          <div className="mt-7">
            <PrimaryButton
              onClick={submit}
              disabled={!phoneValid || (mode === "signin" && password.length < 1) || loading}
              className="h-14 w-full rounded-2xl text-pro-16 shadow-none"
            >
              {loading
                ? mode === "signin"
                  ? t("common.signingIn", "Signing in…")
                  : t("common.sending", "Sending…")
                : mode === "signin"
                  ? t("auth.signIn", "Sign in")
                  : t("common.sendCode")}
            </PrimaryButton>
          </div>

          {role === "customer" ? (
            <div className="mt-6">
              <div className="flex items-center gap-3 text-pro-12 font-semibold text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t("oauth.or")}
                <span className="h-px flex-1 bg-border" />
              </div>
              <button
                type="button"
                disabled={previewMode || googleLoading}
                onClick={async () => {
                  setGoogleLoading(true);
                  const { error } = await signInWithOAuthProvider("google");
                  if (error) {
                    setGoogleLoading(false);
                    toast.error(t("oauth.failedBody"));
                  }
                }}
                className="focus-ring tap-scale mt-5 flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-border bg-white text-pro-14 font-extrabold text-foreground disabled:opacity-60"
              >
                <GoogleMark />
                {googleLoading ? t("oauth.redirecting") : t("oauth.continueWithGoogle")}
              </button>
            </div>
          ) : null}

          <div className="mt-auto pt-8">
            {mode === "signup" ? (
              <p className="text-center text-pro-12 font-semibold leading-7 text-muted-foreground">
                {t("auth.terms")}{" "}
                <Link
                  to="/content/$key"
                  params={{ key: "terms" }}
                  className="py-2 font-extrabold text-foreground underline decoration-border underline-offset-4"
                >
                  {t("auth.termsLink")}
                </Link>{" "}
                {t("auth.and")}{" "}
                <Link
                  to="/content/$key"
                  params={{ key: "privacy" }}
                  className="py-2 font-extrabold text-foreground underline decoration-border underline-offset-4"
                >
                  {t("auth.privacyLink")}
                </Link>
              </p>
            ) : (
              <p className="text-center text-pro-13 font-semibold text-muted-foreground">
                {t("auth.newHere")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("signup");
                    setErrorMsg(null);
                  }}
                  className="inline-flex min-h-11 items-center font-extrabold text-brand"
                >
                  {t("auth.createAccountLink")}
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
