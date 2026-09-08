import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Briefcase, ChevronDown, Eye, EyeOff, User } from "lucide-react";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { PhoneFrame, PrimaryButton, RoleSelectCard } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { otpService, normalizePhone, type Role } from "@/lib/otp/OtpService";
import { startPhoneOtpFlow, phoneOtpFlowErrorMessage } from "@/lib/otp/phoneOtpFlow";
import { resolveLandingForCurrentUser } from "@/lib/auth/landing";
import { previewPath } from "@/lib/preview/previewPath";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";

export const Route = createFileRoute("/login")({ component: Login });

function AuthModeTabs({
  mode,
  onChange,
  signInLabel,
  signUpLabel,
}: {
  mode: "signin" | "signup";
  onChange: (mode: "signin" | "signup") => void;
  signInLabel: string;
  signUpLabel: string;
}) {
  const tabs = [
    { value: "signin" as const, label: signInLabel },
    { value: "signup" as const, label: signUpLabel },
  ];

  return (
    <div className="flex gap-8 border-b border-border/60">
      {tabs.map((tab) => {
        const active = mode === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            aria-pressed={active}
            className={`focus-ring -mb-px pb-3 text-[15px] font-extrabold transition-colors ${
              active
                ? "border-b-[3px] border-brand text-brand"
                : "border-b-[3px] border-transparent text-muted-foreground"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<Role>("customer");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const nav = useNavigate();
  const { setProfile, setAuthed } = useApp();
  const { t, i18n } = useTranslation();

  const phoneValid = phone.replace(/\D/g, "").length >= 9;
  const screenTitle = mode === "signin" ? t("auth.signIn") : t("auth.signUp");

  const submit = async () => {
    if (loading) return;
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
      const landing = await resolveLandingForCurrentUser();
      if (role === "provider") {
        if (landing === "/pro") {
          nav({ to: "/pro" });
        } else {
          const m = t(
            "auth.noProviderAccount",
            "This number has no provider account. Sign up as a provider first.",
          );
          setErrorMsg(m);
          toast.error(m);
        }
      } else {
        nav({ to: "/home" });
      }
      return;
    }

    setLoading(true);
    const send = await startPhoneOtpFlow(e164, "signup", role, { languageCode: i18n.language });
    if (!send.ok) {
      setLoading(false);
      const m = phoneOtpFlowErrorMessage(send.error, t);
      setErrorMsg(m);
      toast.error(m, { duration: 8000 });
      return;
    }
    setProfile({ phone: e164 });
    setLoading(false);
    nav({ to: "/otp" });
  };

  return (
    <PhoneFrame bg="bg-white">
      <div id="firebase-recaptcha" className="hidden" aria-hidden="true" />

      <header className="brand-hero safe-top relative overflow-hidden rounded-b-[2.5rem] px-5 pb-8 pt-4">
        <div className="relative z-10 flex items-start justify-between gap-3">
          <FamyWordmark size="compact" variant="white" className="!h-11 max-w-[9.5rem] object-contain object-left" />
          <LanguageToggle variant="hero" />
        </div>
        <h1 className="relative z-10 mt-8 text-[1.75rem] font-extrabold leading-tight text-white">
          {screenTitle}
        </h1>
      </header>

      <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-8">
        <div className="pt-5">
          <AuthModeTabs
            mode={mode}
            onChange={setMode}
            signInLabel={t("auth.signIn")}
            signUpLabel={t("auth.signUp")}
          />
        </div>

        <section className="mt-8">
          <h2 className="text-sm font-bold text-muted-foreground">
            {mode === "signin" ? t("auth.signInAs") : t("auth.iAmA")}
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <RoleSelectCard
              icon={User}
              label={t("auth.roleCustomer")}
              active={role === "customer"}
              onClick={() => setRole("customer")}
            />
            <RoleSelectCard
              icon={Briefcase}
              label={t("auth.roleProvider")}
              active={role === "provider"}
              onClick={() => setRole("provider")}
            />
          </div>
          {mode === "signup" && role === "provider" ? (
            <p className="mt-3 text-[11px] font-semibold leading-relaxed text-muted-foreground">
              {t("auth.providerNote")}
            </p>
          ) : null}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-bold text-muted-foreground">{t("auth.contactDetails")}</h2>
          <div className="mt-3 space-y-5">
            <div>
              <label className="text-sm font-bold text-foreground">{t("auth.phoneNumber")}</label>
              <div className="mt-2 flex h-14 items-center gap-2 rounded-2xl border border-border/80 bg-white px-3 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-surface-2 px-2 py-1.5 text-[11px] font-extrabold text-foreground"
                  aria-label={t("auth.phoneNumber")}
                >
                  <span aria-hidden="true">🇪🇬</span>
                  <span>EG</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={ICON_STROKE_BOLD} />
                </button>
                <span className="text-[15px] font-extrabold text-foreground" dir="ltr">+20</span>
                <div className="h-6 w-px bg-border/80" />
                <input
                  inputMode="tel"
                  dir="ltr"
                  autoComplete="tel"
                  placeholder={t("auth.phonePlaceholder")}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ""))}
                  className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-muted-foreground/50"
                />
              </div>
            </div>

            {mode === "signin" ? (
              <div>
                <label className="text-sm font-bold text-foreground">{t("auth.password")}</label>
                <div className="mt-2 flex h-14 items-center gap-3 rounded-2xl border border-border/80 bg-white px-4 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
                  <input
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold tracking-widest outline-none placeholder:text-muted-foreground/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? t("auth.hidePassword") : t("auth.showPassword")}
                    className="focus-ring tap-scale grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground"
                  >
                    {showPw ? (
                      <EyeOff className="h-5 w-5" strokeWidth={ICON_STROKE} />
                    ) : (
                      <Eye className="h-5 w-5" strokeWidth={ICON_STROKE} />
                    )}
                  </button>
                </div>
                <div className="mt-3 flex justify-end">
                  <Link to={previewPath("/auth/forgot")} className="text-[13px] font-extrabold text-brand">
                    {t("auth.forgot")}
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
          {errorMsg ? <p className="mt-3 text-sm font-bold text-destructive">{errorMsg}</p> : null}
        </section>

        {mode === "signup" ? (
          <p className="mt-6 text-xs font-semibold leading-relaxed text-muted-foreground">
            {t("auth.terms")}{" "}
            <Link to="/content/$key" params={{ key: "terms" }} className="font-extrabold text-brand">
              {t("auth.termsLink")}
            </Link>{" "}
            {t("auth.and")}{" "}
            <Link to="/content/$key" params={{ key: "privacy" }} className="font-extrabold text-brand">
              {t("auth.privacyLink")}
            </Link>
            .
          </p>
        ) : null}

        <div className="mt-8">
          <PrimaryButton
            onClick={submit}
            disabled={!phoneValid || (mode === "signin" && password.length < 1) || loading}
            className="h-14 w-full rounded-2xl shadow-none"
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

        <p className="mt-6 text-center text-[13px] font-semibold text-muted-foreground">
          {mode === "signin" ? (
            <>
              {t("auth.newHere")}{" "}
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="font-extrabold text-brand"
              >
                {t("auth.createAccountLink")}
              </button>
            </>
          ) : (
            <>
              {t("auth.alreadyHave")}{" "}
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="font-extrabold text-brand"
              >
                {t("auth.signInLink")}
              </button>
            </>
          )}
        </p>
      </div>
    </PhoneFrame>
  );
}
