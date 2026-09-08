import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { CustomerFloatingPanel } from "@/components/famio/CustomerFloatingPanel";
import { PhoneFrame, PrimaryButton, RoleSelectCard, SegmentedControl } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { otpService, normalizePhone, type Role } from "@/lib/otp/OtpService";
import { startPhoneOtpFlow, phoneOtpFlowErrorMessage } from "@/lib/otp/phoneOtpFlow";
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
  const { t, i18n } = useTranslation();

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
    <PhoneFrame bg="bg-[#F10E72]">
      <div id="firebase-recaptcha" className="hidden" aria-hidden="true" />

      <header className="safe-top px-5 pb-24 pt-4">
        <div className="flex items-center justify-end">
          <LanguageToggle variant="inline" />
        </div>
        <FamyWordmark size="auth" variant="white" className="mx-auto mt-6" />
        <h1 className="mx-auto mt-8 text-center text-[1.75rem] font-extrabold leading-tight text-white">
          {mode === "signin" ? t("auth.signIn") : t("auth.signUp")}
        </h1>
        {mode === "signup" ? (
          <p className="mx-auto mt-2 max-w-[18rem] text-center text-sm font-semibold leading-relaxed text-white/80">
            {t("auth.signupBody")}
          </p>
        ) : null}
      </header>

      <CustomerFloatingPanel className="mx-5 -mt-14 flex-1 space-y-6">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: "signin", label: t("auth.signIn") },
            { value: "signup", label: t("auth.signUp") },
          ]}
        />

        <section>
          <p className="text-overline">{mode === "signin" ? t("auth.signInAs") : t("auth.iAmA")}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
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
            <p className="mt-3 text-[11px] font-bold leading-relaxed text-muted-foreground">
              {t("auth.providerNote")}
            </p>
          ) : null}
        </section>

        <section>
          <p className="text-overline">{t("auth.contactDetails")}</p>
          <div className="mt-3 space-y-4">
            <div>
              <label className="text-xs font-bold text-muted-foreground">{t("auth.phoneNumber")}</label>
              <div className="mt-2 flex h-14 items-center gap-3 rounded-2xl bg-surface-2 px-4 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-[10px] font-black text-foreground shadow-xs border border-border/50"
                  aria-hidden="true"
                >
                  EG
                </span>
                <span className="text-[15px] font-black text-foreground" dir="ltr">+20</span>
                <div className="h-6 w-px bg-border/80" />
                <input
                  inputMode="tel"
                  dir="ltr"
                  autoComplete="tel"
                  placeholder={t("auth.phonePlaceholder")}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ""))}
                  className="min-w-0 flex-1 bg-transparent text-[15px] font-black outline-none placeholder:text-muted-foreground/60"
                />
              </div>
            </div>

            {mode === "signin" ? (
              <div>
                <label className="text-xs font-bold text-muted-foreground">{t("auth.password")}</label>
                <div className="mt-2 flex h-14 items-center gap-3 rounded-2xl bg-surface-2 px-4 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
                  <input
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[15px] font-black tracking-widest outline-none placeholder:text-muted-foreground/60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? t("auth.hidePassword") : t("auth.showPassword")}
                    className="focus-ring tap-scale grid h-10 w-10 min-h-10 min-w-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {showPw ? (
                      <EyeOff className="h-5 w-5" strokeWidth={ICON_STROKE} />
                    ) : (
                      <Eye className="h-5 w-5" strokeWidth={ICON_STROKE} />
                    )}
                  </button>
                </div>
                <div className="mt-3 flex justify-end">
                  <Link to="/auth/forgot" className="text-[13px] font-extrabold text-brand">
                    {t("auth.forgot")}
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
          {errorMsg ? <p className="mt-3 text-sm font-bold text-destructive">{errorMsg}</p> : null}
        </section>

        {mode === "signup" ? (
          <p className="text-xs font-semibold leading-relaxed text-muted-foreground text-center">
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

        <p className="text-center text-[13px] font-bold text-muted-foreground">
          {mode === "signin" ? (
            <>
              {t("auth.newHere")}{" "}
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="font-black text-brand underline-offset-2 hover:underline"
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
                className="font-black text-brand underline-offset-2 hover:underline"
              >
                {t("auth.signInLink")}
              </button>
            </>
          )}
        </p>

        <PrimaryButton
          onClick={submit}
          disabled={!phoneValid || (mode === "signin" && password.length < 1) || loading}
          className="h-14 w-full shadow-float"
        >
          {loading
            ? mode === "signin"
              ? t("common.signingIn", "Signing in…")
              : t("common.sending", "Sending…")
            : mode === "signin"
              ? t("auth.signIn", "Sign in")
              : t("common.sendCode")}
        </PrimaryButton>
      </CustomerFloatingPanel>
    </PhoneFrame>
  );
}
