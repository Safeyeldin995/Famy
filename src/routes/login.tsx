import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff, User, Briefcase } from "lucide-react";
import { PhoneFrame, PrimaryButton, TopBar } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import famyLogo from "@/assets/famy-wordmark.png";
import { otpService, normalizePhone, type Role } from "@/lib/otp/OtpService";
import { resolveLandingForCurrentUser } from "@/lib/auth/landing";

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
  const { setProfile, setAuthed, setAuthIntent } = useApp();
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
      // Route by the workspace the user chose, NOT by DB role.
      // Admins can navigate to /admin manually from their account menu.
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
        // Customer workspace: always /home, regardless of provider/admin role.
        nav({ to: "/home" });
      }
      return;
    }




    // signup: TEMPORARY — OTP disabled during pre-launch validation phase.
    // Skip the /otp screen entirely; create the account immediately using a
    // placeholder code that the server-side verify handler ignores. Re-enable
    // OTP before accepting unmonitored public signups.
    setLoading(true);
    const send = await otpService.sendOtp(e164, "signup");
    if (!send.ok) {
      setLoading(false);
      let m = t("auth.sendFailed", "Could not create account.");
      if (send.error === "already_registered") {
        m = t("auth.alreadyRegistered", "This number is already registered. Please sign in.");
        setMode("signin");
      } else if (send.message) {
        m = send.message;
      }
      setErrorMsg(m);
      toast.error(m, { duration: 8000 });
      return;
    }
    const verify = await otpService.verifyOtp(e164, "000000", "signup", role);
    setLoading(false);
    if (!verify.ok) {
      const m = verify.message ?? t("auth.verifyFailed", "Could not create account.");
      setErrorMsg(m);
      toast.error(m, { duration: 8000 });
      return;
    }
    setProfile({ phone: e164 });
    setAuthIntent({ purpose: "signup", role });
    setAuthed(true);
    nav({ to: "/auth/set-password" });
  };

  return (
    <PhoneFrame bg="bg-surface">
      <TopBar back={{ to: "/onboarding" }} right={<LanguageToggle variant="inline" />} />
      <div className="flex-1 px-6 pt-2">
        <img src={famyLogo} alt={t("common.appName")} className="h-12 w-auto object-contain" />
        <p className="mt-3 text-[15px] text-muted-foreground">
          {mode === "signin" ? t("auth.signinBody", "Welcome back.") : t("auth.signupBody", "Create your Famy account.")}
        </p>

        {/* Mode tabs */}
        <div className="mt-6 grid grid-cols-2 rounded-2xl bg-surface-2 p-1">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`h-11 rounded-xl text-sm font-bold transition-all ${
                mode === m ? "bg-navy text-navy-foreground shadow-soft" : "text-muted-foreground"
              }`}
            >
              {m === "signin" ? t("auth.signIn", "Sign in") : t("auth.signUp", "Sign up")}
            </button>
          ))}
        </div>

        {/* Role / workspace picker (shown for both signin and signup) */}
        <label className="mt-6 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {mode === "signin" ? t("auth.signInAs", "Sign in as") : t("auth.iAmA", "I am a")}
        </label>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {([
            { v: "customer" as Role, icon: User, label: t("auth.roleCustomer", "Customer") },
            { v: "provider" as Role, icon: Briefcase, label: t("auth.roleProvider", "Service Provider") },
          ]).map((r) => {
            const Icon = r.icon;
            const active = role === r.v;
            return (
              <button
                key={r.v}
                onClick={() => setRole(r.v)}
                className={`flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-start transition-all ${
                  active ? "border-navy bg-navy/[0.04]" : "border-border bg-surface"
                }`}
              >
                <span className={`grid h-9 w-9 place-items-center rounded-xl ${active ? "bg-navy text-navy-foreground" : "bg-surface-2 text-muted-foreground"}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-bold">{r.label}</span>
              </button>
            );
          })}
        </div>
        {mode === "signup" && role === "provider" && (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {t("auth.providerNote", "Providers must complete verification and admin approval before receiving bookings.")}
          </p>
        )}


        {/* Phone */}
        <label className="mt-6 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("auth.phoneNumber")}
        </label>
        <div className="mt-2 flex h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 focus-within:border-navy">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xl">🇪🇬</span>
            <span className="text-base font-bold" dir="ltr">+20</span>
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

        {/* Password (signin only) */}
        {mode === "signin" && (
          <>
            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t("auth.password", "Password")}
            </label>
            <div className="mt-2 flex h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 focus-within:border-navy">
              <input
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground/60"
              />
              <button onClick={() => setShowPw((v) => !v)} aria-label="toggle password" className="text-muted-foreground">
                {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <div className="mt-3 text-end">
              <Link to="/auth/forgot" className="text-sm font-semibold text-navy">
                {t("auth.forgot", "Forgot password?")}
              </Link>
            </div>
          </>
        )}

        {mode === "signup" && (
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            {t("auth.terms")}{" "}
            <Link to="/help" className="font-semibold text-navy">{t("auth.termsLink")}</Link>{" "}
            {t("auth.and")}{" "}
            <Link to="/help" className="font-semibold text-navy">{t("auth.privacyLink")}</Link>.
          </p>
        )}
      </div>

      <div className="safe-bottom px-6 pt-4">
        {errorMsg && (
          <div className="mb-3 rounded-2xl border border-coral/30 bg-coral/10 p-3 text-[13px] font-medium leading-relaxed text-coral">
            {errorMsg}
          </div>
        )}
        <PrimaryButton
          onClick={submit}
          disabled={
            loading ||
            !phoneValid ||
            (mode === "signin" && password.length < 1)
          }
        >
          {loading
            ? (mode === "signin" ? t("common.signingIn", "Signing in…") : t("common.sending", "Sending…"))
            : (mode === "signin" ? t("auth.signIn", "Sign in") : t("common.sendCode"))}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}
