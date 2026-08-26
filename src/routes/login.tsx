import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff, Phone } from "lucide-react";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { BackButton, PhoneFrame, PrimaryButton, RoleSelectCard, SegmentedControl } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { otpService, normalizePhone, type Role } from "@/lib/otp/OtpService";
import { resolveLandingForCurrentUser } from "@/lib/auth/landing";
import { ICON_STROKE } from "@/lib/icons/constants";

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
          const m = t("auth.noProviderAccount");
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
      const m = send.message ?? t("auth.sendFailed");
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
      <div className="home-hero-shell safe-top px-5 pb-4 pt-3">
        <div className="flex items-center justify-between gap-3">
          <BackButton back={{ to: "/onboarding" }} />
          <LanguageToggle variant="inline" />
        </div>
        <FamyWordmark size="auth" className="mx-auto mt-8" />
        <p className="mx-auto mt-4 max-w-[18rem] text-center text-sm text-muted-foreground">
          {mode === "signin" ? t("auth.signinBody") : t("auth.signupBody")}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 pt-2">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: "signin", label: t("auth.signIn") },
            { value: "signup", label: t("auth.signUp") },
          ]}
        />

        <section className="mt-8">
          <p className="text-overline">{mode === "signin" ? t("auth.signInAs") : t("auth.iAmA")}</p>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <RoleSelectCard
              label={t("auth.roleCustomer")}
              active={role === "customer"}
              onClick={() => setRole("customer")}
            />
            <RoleSelectCard
              label={t("auth.roleProvider")}
              active={role === "provider"}
              onClick={() => setRole("provider")}
            />
          </div>
          {mode === "signup" && role === "provider" ? (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("auth.providerNote")}</p>
          ) : null}
        </section>

        <section className="mt-8">
          <p className="text-overline">{t("auth.contactDetails")}</p>
          <div className="surface-card mt-3 space-y-4 p-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">{t("auth.phoneNumber")}</label>
              <div className="mt-2 flex min-h-[3.5rem] items-center gap-3 rounded-xl border border-border/80 bg-background px-3 focus-within:ring-2 focus-within:ring-brand/25">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-[10px] font-extrabold text-foreground" aria-hidden="true">EG</span>
                <span className="text-sm font-bold text-foreground" dir="ltr">+20</span>
                <div className="h-6 w-px bg-border" />
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
            </div>

            {mode === "signin" ? (
              <div>
                <label className="text-xs font-semibold text-muted-foreground">{t("auth.password")}</label>
                <div className="mt-2 flex min-h-[3.5rem] items-center gap-3 rounded-xl border border-border/80 bg-background px-3 focus-within:ring-2 focus-within:ring-brand/25">
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
                    aria-label={showPw ? t("auth.hidePassword") : t("auth.showPassword")}
                    className="focus-ring tap-scale grid h-10 w-10 min-h-10 min-w-10 place-items-center rounded-lg text-muted-foreground"
                  >
                    {showPw ? <EyeOff className="h-5 w-5" strokeWidth={ICON_STROKE} /> : <Eye className="h-5 w-5" strokeWidth={ICON_STROKE} />}
                  </button>
                </div>
                <div className="mt-2 text-end">
                  <Link to="/auth/forgot" className="text-xs font-semibold text-brand underline-offset-2 hover:underline">
                    {t("auth.forgot")}
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {mode === "signup" ? (
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            {t("auth.terms")}{" "}
            <Link to="/content/$key" params={{ key: "terms" }} className="font-semibold text-brand">
              {t("auth.termsLink")}
            </Link>{" "}
            {t("auth.and")}{" "}
            <Link to="/content/$key" params={{ key: "privacy" }} className="font-semibold text-brand">
              {t("auth.privacyLink")}
            </Link>
            .
          </p>
        ) : null}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signin" ? (
            <>
              {t("auth.newHere")}{" "}
              <button type="button" onClick={() => setMode("signup")} className="font-bold text-brand">
                {t("auth.createAccountLink")}
              </button>
            </>
          ) : (
            <>
              {t("auth.alreadyHave")}{" "}
              <button type="button" onClick={() => setMode("signin")} className="font-bold text-brand">
                {t("auth.signInLink")}
              </button>
            </>
          )}
        </p>
      </div>

      <div className="safe-bottom border-t border-border/60 bg-surface/95 px-5 pt-3 backdrop-blur">
        {errorMsg ? (
          <div className="mb-3 rounded-xl border border-brand/25 bg-brand/10 p-3 text-[13px] font-medium leading-relaxed text-brand">
            {errorMsg}
          </div>
        ) : null}
        <PrimaryButton
          onClick={submit}
          disabled={loading || !phoneValid || (mode === "signin" && password.length < 1)}
        >
          {loading
            ? mode === "signin"
              ? t("common.signingIn")
              : t("common.sending")
            : mode === "signin"
              ? t("auth.signIn")
              : t("common.sendCode")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}
