import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff, User, Briefcase, Phone } from "lucide-react";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { PhoneFrame, PrimaryButton, TopBar } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { otpService, normalizePhone, type Role } from "@/lib/otp/OtpService";
import { resolveLandingForCurrentUser } from "@/lib/auth/landing";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";

export const Route = createFileRoute("/login")({ component: Login });

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
  const { t } = useTranslation();

  const phoneValid = phone.replace(/\D/g, "").length >= 9;

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
        const m = t("auth.invalidCredentials", "Wrong phone or password.");
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
          const m = t("auth.noProviderAccount", "This number has no provider account. Sign up as a provider first.");
          setErrorMsg(m);
          toast.error(m);
        }
      } else {
        nav({ to: "/home" });
      }
      return;
    }

    setLoading(true);
    const send = await otpService.sendOtp(e164, "signup", role);
    if (!send.ok) {
      setLoading(false);
      const m = send.message ?? t("auth.sendFailed", "Could not create account.");
      setErrorMsg(m);
      toast.error(m, { duration: 8000 });
      return;
    }
    setProfile({ phone: e164 });
    setLoading(false);
    nav({ to: "/otp" });
  };

  return (
    <PhoneFrame bg="bg-background">
      <TopBar back={{ to: "/onboarding" }} right={<LanguageToggle variant="inline" />} transparent />
      <div className="flex-1 px-5 pt-1">
        <FamyWordmark size="auth" />
        <p className="mt-4 text-body text-muted-foreground">
          {mode === "signin" ? t("auth.signinBody", "Welcome back.") : t("auth.signupBody", "Create your Famy account.")}
        </p>

        <div className="surface-card mt-6 p-1.5">
          <div className="grid grid-cols-2 gap-1">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`focus-ring tap-scale min-h-11 rounded-xl text-sm font-bold transition-all ${
                  mode === m ? "bg-ink text-ink-foreground shadow-soft" : "text-muted-foreground"
                }`}
              >
                {m === "signin" ? t("auth.signIn", "Sign in") : t("auth.signUp", "Sign up")}
              </button>
            ))}
          </div>
        </div>

        <p className="text-overline mt-6">
          {mode === "signin" ? t("auth.signInAs", "Sign in as") : t("auth.iAmA", "I am a")}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {([
            { v: "customer" as Role, icon: User, label: t("auth.roleCustomer", "Customer") },
            { v: "provider" as Role, icon: Briefcase, label: t("auth.roleProvider", "Service Provider") },
          ]).map((r) => {
            const Icon = r.icon;
            const active = role === r.v;
            return (
              <button
                key={r.v}
                type="button"
                onClick={() => setRole(r.v)}
                className={`focus-ring tap-scale surface-card flex min-h-[5.5rem] flex-col items-start gap-2 p-4 text-start transition-all ${
                  active ? "border-ink/35 ring-1 ring-ink/20" : ""
                }`}
              >
                <span
                  className={`grid h-10 w-10 place-items-center rounded-xl ${
                    active ? "bg-ink/10 text-ink" : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} />
                </span>
                <span className="text-sm font-bold text-foreground">{r.label}</span>
              </button>
            );
          })}
        </div>
        {mode === "signup" && role === "provider" && (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {t("auth.providerNote", "Providers must complete verification and admin approval before receiving bookings.")}
          </p>
        )}

        <p className="text-overline mt-6">{t("auth.phoneNumber")}</p>
        <div className="surface-card mt-3 flex min-h-[3.75rem] items-center gap-3 px-4 focus-within:ring-2 focus-within:ring-ink/25">
          <div className="flex shrink-0 items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand/10 text-brand">
              <Phone className="h-4 w-4" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            </span>
            <span className="text-sm font-bold text-foreground" dir="ltr">
              +20
            </span>
          </div>
          <div className="h-7 w-px bg-border" />
          <input
            inputMode="tel"
            dir="ltr"
            autoComplete="tel"
            placeholder={t("auth.phonePlaceholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ""))}
            className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        {mode === "signin" && (
          <>
            <p className="text-overline mt-5">{t("auth.password", "Password")}</p>
            <div className="surface-card mt-3 flex min-h-[3.75rem] items-center gap-3 px-4 focus-within:ring-2 focus-within:ring-ink/25">
              <input
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground/60"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t("auth.hidePassword", "Hide password") : t("auth.showPassword", "Show password")}
                className="focus-ring tap-scale grid h-11 w-11 min-h-11 min-w-11 place-items-center rounded-xl text-muted-foreground"
              >
                {showPw ? (
                  <EyeOff className="h-5 w-5" strokeWidth={ICON_STROKE} />
                ) : (
                  <Eye className="h-5 w-5" strokeWidth={ICON_STROKE} />
                )}
              </button>
            </div>
            <div className="mt-3 text-end">
              <Link to="/auth/forgot" className="text-sm font-semibold text-ink">
                {t("auth.forgot", "Forgot password?")}
              </Link>
            </div>
          </>
        )}

        {mode === "signup" && (
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            {t("auth.terms")}{" "}
            <Link to="/content/$key" params={{ key: "terms" }} className="font-semibold text-ink">
              {t("auth.termsLink")}
            </Link>{" "}
            {t("auth.and")}{" "}
            <Link to="/content/$key" params={{ key: "privacy" }} className="font-semibold text-ink">
              {t("auth.privacyLink")}
            </Link>
            .
          </p>
        )}
      </div>

      <div className="safe-bottom px-5 pt-4">
        {errorMsg && (
          <div className="mb-3 rounded-2xl border border-brand/25 bg-brand/10 p-3 text-[13px] font-medium leading-relaxed text-brand">
            {errorMsg}
          </div>
        )}
        <PrimaryButton
          onClick={submit}
          disabled={loading || !phoneValid || (mode === "signin" && password.length < 1)}
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
    </PhoneFrame>
  );
}
