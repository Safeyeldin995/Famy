import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff, Phone, ArrowRight } from "lucide-react";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { BackButton, PhoneFrame, PrimaryButton, RoleSelectCard, SegmentedControl } from "@/components/famio/ui";
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
      <div className="safe-top px-5 pb-4 pt-6">
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => nav({ to: "/onboarding" })} aria-label={t("common.back")} className="focus-ring tap-scale grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-foreground" data-rtl-flip="true">
            <ArrowRight className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} />
          </button>
          <LanguageToggle variant="inline" />
        </div>
        <FamyWordmark size="auth" className="mx-auto mt-12" />
        <p className="mx-auto mt-6 max-w-[18rem] text-center text-sm font-semibold leading-relaxed text-muted-foreground">
          {mode === "signin" ? t("auth.signinBody") : t("auth.signupBody")}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: "signin", label: t("auth.signIn") },
            { value: "signup", label: t("auth.signUp") },
          ]}
        />

        <section className="mt-8">
          <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{mode === "signin" ? t("auth.signInAs") : t("auth.iAmA")}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
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
            <p className="mt-3 text-[11px] font-bold leading-relaxed text-muted-foreground">{t("auth.providerNote")}</p>
          ) : null}
        </section>

        <section className="mt-8">
          <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{t("auth.contactDetails")}</p>
          <div className="mt-4 space-y-4 rounded-[2.5rem] border border-border/50 bg-surface-elevated p-6 shadow-sm">
            <div>
              <label className="text-xs font-bold text-muted-foreground">{t("auth.phoneNumber")}</label>
              <div className="mt-2 flex h-14 items-center gap-3 rounded-2xl bg-surface-2 px-4 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-[10px] font-black text-foreground shadow-xs border border-border/50" aria-hidden="true">EG</span>
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
                    {showPw ? <EyeOff className="h-5 w-5" strokeWidth={ICON_STROKE} /> : <Eye className="h-5 w-5" strokeWidth={ICON_STROKE} />}
                  </button>
                </div>
                <div className="mt-4 flex justify-end">
                  <Link to="/auth/forgot" className="text-[13px] font-extrabold text-brand transition-colors hover:text-brand/80">
                    {t("auth.forgot")}
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
          {errorMsg ? <p className="mt-4 text-sm font-bold text-destructive px-1">{errorMsg}</p> : null}
        </section>

        {mode === "signup" ? (
          <p className="mt-8 text-xs font-semibold leading-relaxed text-muted-foreground text-center px-4">
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

        <p className="mt-8 text-center text-[13px] font-bold text-muted-foreground">
          {mode === "signin" ? (
            <>
              {t("auth.newHere")}{" "}
              <button type="button" onClick={() => setMode("signup")} className="font-black text-brand underline-offset-2 hover:underline">
                {t("auth.createAccountLink")}
              </button>
            </>
          ) : (
            <>
              {t("auth.alreadyHave")}{" "}
              <button type="button" onClick={() => setMode("signin")} className="font-black text-brand underline-offset-2 hover:underline">
                {t("auth.signInLink")}
              </button>
            </>
          )}
        </p>
      </div>

      <div className="safe-bottom p-5">
        <PrimaryButton
          onClick={submit}
          disabled={!phoneValid || (mode === "signin" && password.length < 1) || loading}
          className="shadow-float h-14"
        >
          {loading ? t("auth.sending") : mode === "signin" ? t("auth.signIn") : t("auth.signUp")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}
