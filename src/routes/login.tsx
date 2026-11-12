import { createFileRoute, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { PhoneFrame, PrimaryButton } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { otpService, normalizePhone, type Role } from "@/lib/otp/OtpService";
import { normalizeDigitsToWestern } from "@/lib/otp/normalizePhone";
import { startPhoneOtpFlow, phoneOtpFlowErrorMessage } from "@/lib/otp/phoneOtpFlow";
import { interpretSignupSendForLoginPhoneContinue } from "@/lib/auth/loginPhoneContinue";
import {
  resolvePostPasswordLoginTarget,
  resolveRoleLandingForCurrentUser,
} from "@/lib/auth/landing";
import { ACCOUNT_DELETE_INTENT } from "@/lib/web/webSurface";
import { useCustomerPreviewPath } from "@/components/famio/useCustomerPreviewPath";
import { ICON_STROKE } from "@/lib/icons/constants";
import {
  enabledWebOAuthProviders,
  signInWithOAuthProvider,
  type OAuthProvider,
} from "@/lib/auth/oauth";

export const Route = createFileRoute("/login")({ component: Login });

function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5"} aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.05 20.28c-.98.95-2.05 1.88-3.08 1.88-1.02 0-1.31-.63-2.42-.63-1.11 0-1.45.64-2.43.66-1 .02-1.76-.93-2.74-1.88C4.25 17.2 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.03-.02 2 .69 2.65.69.63 0 1.81-.85 3.06-.73.52.02 1.98.21 2.92 1.58-.08.05-1.74 1.02-1.72 2.98.03 2.36 2.06 3.15 2.09 3.17-.02.06-.32 1.11-1.05 2.18zM12.03 7.25c.57-.69 1.03-1.65.92-2.61-.89.04-1.96.59-2.6 1.33-.53.61-1 1.58-.88 2.51.93.07 1.88-.47 2.56-1.23z"
      />
    </svg>
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

type Step = "phone" | "password";

export function Login({ previewMode = false }: { previewMode?: boolean } = {}) {
  const loginSearch = useRouterState({
    select: (s) => {
      const raw = s.location.search as { mode?: string; phone?: string; intent?: string };
      return {
        mode:
          raw.mode === "signup"
            ? ("signup" as const)
            : raw.mode === "signin"
              ? ("signin" as const)
              : undefined,
        phone: typeof raw.phone === "string" ? raw.phone : undefined,
        intent: raw.intent,
      };
    },
  });
  const accountDeleteFlow = !previewMode && loginSearch.intent === ACCOUNT_DELETE_INTENT;
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<Role>(loginSearch.mode === "signup" ? "provider" : "customer");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const oauthProviders = enabledWebOAuthProviders();
  const nav = useNavigate();
  const { setProfile, setAuthed } = useApp();
  const { t, i18n } = useTranslation();
  const previewPath = useCustomerPreviewPath();

  useEffect(() => {
    if (loginSearch.mode === "signup") setRole("provider");
    if (loginSearch.phone) {
      const local = loginSearch.phone.replace(/^\+20/, "").replace(/\D/g, "");
      if (local.length > 0) setPhone(local);
    }
  }, [loginSearch.mode, loginSearch.phone]);

  const phoneValid = normalizeDigitsToWestern(phone).replace(/\D/g, "").length >= 9;
  const providerMode = role === "provider";
  const showOAuth =
    !accountDeleteFlow && role === "customer" && step === "phone" && oauthProviders.length > 0;

  const resetPhoneStep = () => {
    setStep("phone");
    setPassword("");
    setErrorMsg(null);
  };

  const signInWithPassword = async () => {
    if (password.length < 1) return;
    setLoading(true);
    const e164 = normalizePhone(phone);
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
    if (accountDeleteFlow) {
      nav({ to: "/account/delete", replace: true });
      return;
    }
    const roleLanding = await resolveRoleLandingForCurrentUser();
    const target = resolvePostPasswordLoginTarget({
      loginRole: role,
      landing: roleLanding?.landing ?? null,
      hasProviderRole: roleLanding?.hasProviderRole ?? false,
    });
    if (target === "provider_account_missing") {
      const m = t("auth.noProviderAccount");
      setErrorMsg(m);
      toast.error(m);
      return;
    }
    if (target) {
      nav({ to: target });
    }
  };

  const continueWithPhone = async () => {
    const e164 = normalizePhone(phone);
    setLoading(true);
    const send = await startPhoneOtpFlow(e164, "signup", role, { languageCode: i18n.language });
    setLoading(false);
    const interpreted = interpretSignupSendForLoginPhoneContinue(
      send.ok
        ? { ok: true }
        : {
            ok: false,
            error: send.error,
            nextStep: send.nextStep,
            retryAfter: send.retryAfter,
            firebaseAuthCode: send.firebaseAuthCode,
          },
    );
    if (interpreted.kind === "flow_mismatch_signup") {
      const m = t("auth.noAccount");
      setErrorMsg(m);
      toast.error(m, { duration: 8000 });
      return;
    }
    if (interpreted.kind === "registered") {
      setStep("password");
      return;
    }
    if (interpreted.kind === "proceed_signup_otp") {
      setProfile({ phone: e164 });
      nav({ to: "/otp" });
      return;
    }
    const m = phoneOtpFlowErrorMessage(
      interpreted.error as Parameters<typeof phoneOtpFlowErrorMessage>[0],
      t,
      interpreted.retryAfter,
      interpreted.firebaseAuthCode,
    );
    setErrorMsg(m);
    toast.error(m, { duration: 8000 });
  };

  const submit = async () => {
    if (previewMode || loading || !phoneValid) return;
    setErrorMsg(null);
    if (step === "password") {
      await signInWithPassword();
      return;
    }
    await continueWithPhone();
  };

  const fieldClass =
    "flex h-14 items-center rounded-2xl border border-border/80 bg-white transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15";

  const primaryDisabled =
    !phoneValid || loading || (step === "password" && password.length < 1);

  const primaryLabel =
    loading && step === "password"
      ? t("common.signingIn")
      : loading
        ? t("common.sending")
        : step === "password"
          ? t("auth.signIn")
          : t("auth.continue");

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
          {providerMode ? (
            <div className="space-y-2 pt-10">
              <h1 className="text-[1.875rem] font-extrabold leading-tight text-foreground text-balance">
                {t("auth.providerSignupTitle")}
              </h1>
              <p className="text-pro-14 font-medium leading-relaxed text-muted-foreground">
                {t("auth.signUpSubtitle")}
              </p>
              <button
                type="button"
                onClick={() => {
                  setRole("customer");
                  resetPhoneStep();
                }}
                className="focus-ring inline-flex min-h-11 items-center text-pro-13 font-extrabold text-brand"
              >
                {t("auth.backToCustomerLogin")}
              </button>
              <p className="rounded-2xl bg-brand/[0.06] px-4 py-3 text-pro-12 font-semibold leading-relaxed text-foreground/80">
                {t("auth.providerNote")}
              </p>
            </div>
          ) : step === "password" ? (
            <div className="space-y-2 pt-10">
              <h1 className="text-[1.875rem] font-extrabold leading-tight text-foreground text-balance">
                {t("auth.welcomeBack")}
              </h1>
              <p className="text-pro-14 font-medium leading-relaxed text-muted-foreground">
                {t("auth.signInSubtitle")}
              </p>
            </div>
          ) : (
            <div className="pt-10" aria-hidden="true" />
          )}

          <section className="mt-6 space-y-5">
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
                  onChange={(e) => {
                    setPhone(e.target.value.replace(/[^\d ]/g, ""));
                    if (step === "password") resetPhoneStep();
                  }}
                  className="min-h-11 min-w-0 flex-1 bg-transparent px-1 text-[16px] font-bold tracking-wide outline-none placeholder:font-semibold placeholder:text-muted-foreground/50"
                />
              </div>
            </div>

            {step === "password" ? (
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
              <div className="rounded-2xl bg-destructive/10 px-4 py-3">
                <p className="text-pro-13 font-bold text-destructive">{errorMsg}</p>
              </div>
            ) : null}
          </section>

          <div className="mt-7">
            <PrimaryButton
              onClick={submit}
              disabled={primaryDisabled}
              className="h-14 w-full rounded-2xl text-pro-16 shadow-none"
            >
              {primaryLabel}
            </PrimaryButton>
          </div>

          {showOAuth ? (
            <div className="mt-6">
              <div className="flex items-center gap-3 text-pro-12 font-semibold text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t("oauth.or")}
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="mt-5 flex flex-col gap-3">
                {oauthProviders.includes("google") ? (
                  <button
                    type="button"
                    disabled={previewMode || oauthLoading !== null}
                    onClick={async () => {
                      setOauthLoading("google");
                      const { error } = await signInWithOAuthProvider("google");
                      if (error) {
                        setOauthLoading(null);
                        toast.error(t("oauth.failedBody"));
                      }
                    }}
                    className="focus-ring tap-scale flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-border bg-white text-pro-14 font-extrabold text-foreground disabled:opacity-60"
                  >
                    <GoogleMark />
                    {oauthLoading === "google"
                      ? t("oauth.redirectingGoogle")
                      : t("oauth.continueWithGoogle")}
                  </button>
                ) : null}
                {oauthProviders.includes("apple") ? (
                  <button
                    type="button"
                    disabled={previewMode || oauthLoading !== null}
                    onClick={async () => {
                      setOauthLoading("apple");
                      const { error } = await signInWithOAuthProvider("apple");
                      if (error) {
                        setOauthLoading(null);
                        toast.error(t("oauth.failedBody"));
                      }
                    }}
                    className="focus-ring tap-scale flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-black text-pro-14 font-extrabold text-white disabled:opacity-60"
                  >
                    <AppleMark />
                    {oauthLoading === "apple"
                      ? t("oauth.redirectingApple")
                      : t("oauth.continueWithApple")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-auto pt-8">
            {!accountDeleteFlow && !providerMode && step === "phone" ? (
              <button
                type="button"
                onClick={() => {
                  setRole("provider");
                  resetPhoneStep();
                }}
                className="focus-ring mx-auto flex min-h-11 w-full items-center justify-center text-pro-13 font-extrabold text-brand"
              >
                {t("auth.providerSignupLink")}
              </button>
            ) : null}
            {providerMode && step === "phone" ? (
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
            ) : null}
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
