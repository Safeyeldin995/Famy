import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { PhoneFrame, PrimaryButton } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { otpService, normalizePhone } from "@/lib/otp/OtpService";
import { normalizeDigitsToWestern } from "@/lib/otp/normalizePhone";
import { supabase } from "@/integrations/supabase/client";
import { useMyRole } from "@/lib/db/provider-queries";

export const Route = createFileRoute("/staff")({
  head: () => ({
    meta: [{ title: "دخول فريق فامي | Famy" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: StaffSignIn,
});

function StaffSignIn() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const role = useMyRole();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  const phoneValid = normalizeDigitsToWestern(phone).replace(/\D/g, "").length >= 9;

  useEffect(() => {
    if (signedIn && !role.isLoading && role.data === "admin") {
      void nav({ to: "/admin", replace: true });
    }
  }, [signedIn, role.isLoading, role.data, nav]);

  if (signedIn && !role.isLoading && role.data !== "admin") {
    return (
      <PhoneFrame bg="bg-white">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <h1 className="text-xl font-extrabold">{t("staff.notAdmin")}</h1>
          <PrimaryButton
            className="mt-2 min-h-12 px-8"
            onClick={async () => {
              await supabase.auth.signOut();
              setSignedIn(false);
              setPassword("");
              setErrorMsg(null);
            }}
          >
            {t("admin.layout.signOut")}
          </PrimaryButton>
        </div>
      </PhoneFrame>
    );
  }

  const submit = async () => {
    if (loading || !phoneValid || password.length < 1) return;
    setErrorMsg(null);
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
    setSignedIn(true);
  };

  const fieldClass =
    "flex h-14 items-center rounded-2xl border border-border/80 bg-white transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15";

  return (
    <PhoneFrame bg="bg-white">
      <div className="relative flex flex-1 flex-col overflow-y-auto">
        <header className="safe-top relative flex items-center justify-between gap-3 px-6 pt-4">
          <FamyWordmark size="compact" className="!h-9 max-w-[7.5rem]" />
          <LanguageToggle />
        </header>
        <div className="relative flex flex-1 flex-col px-6 pb-8 pt-10">
          <h1 className="text-[1.875rem] font-extrabold leading-tight">{t("staff.title")}</h1>
          <p className="mt-2 text-pro-14 font-medium text-muted-foreground">{t("staff.subtitle")}</p>

          <div className="mt-8 space-y-5">
            <div>
              <label
                htmlFor="staff-phone"
                className="mb-2 block text-pro-13 font-bold text-muted-foreground"
              >
                {t("auth.phoneNumber")}
              </label>
              <div dir="ltr" className={`${fieldClass} gap-2 px-3`}>
                <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-surface-2 px-2.5 text-pro-14 font-extrabold">
                  🇪🇬 +20
                </span>
                <input
                  id="staff-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  className="min-h-11 flex-1 bg-transparent text-pro-16 font-semibold outline-none"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="staff-password"
                className="mb-2 block text-pro-13 font-bold text-muted-foreground"
              >
                {t("auth.password")}
              </label>
              <div dir="ltr" className={`${fieldClass} gap-2 px-3`}>
                <input
                  id="staff-password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  className="min-h-11 flex-1 bg-transparent text-pro-16 font-semibold outline-none"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? t("auth.hidePassword") : t("auth.showPassword")}
                >
                  {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            {errorMsg ? (
              <p role="alert" className="text-pro-13 font-semibold text-destructive">
                {errorMsg}
              </p>
            ) : null}
            <PrimaryButton
              className="min-h-14 w-full"
              disabled={!phoneValid || password.length < 1 || loading}
              onClick={() => void submit()}
            >
              {loading ? t("common.loading") : t("auth.signIn")}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
