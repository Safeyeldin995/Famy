import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff, Check } from "lucide-react";
import { PhoneFrame, PrimaryButton, TopBar } from "@/components/famio/ui";
import { otpService } from "@/lib/otp/OtpService";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/set-password")({ component: SetPassword });

function SetPassword() {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  const { t } = useTranslation();
  const { authIntent, setAuthIntent } = useApp();

  useEffect(() => {
    // Must be signed in to set a password.
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) nav({ to: "/login", replace: true });
    });
  }, [nav]);

  const longEnough = pw.length >= 8;
  const valid = longEnough;

  const submit = async () => {
    if (!valid || loading) return;
    setErr(null);
    setLoading(true);
    // Ensure we still have a session before calling updateUser.
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setLoading(false);
      setErr(t("auth.sessionExpired", "Your session expired. Please verify your phone again."));
      toast.error(t("auth.sessionExpired", "Your session expired. Please verify your phone again."));
      setTimeout(() => nav({ to: "/login", replace: true }), 1200);
      return;
    }
    const res = await otpService.setPassword(pw);
    setLoading(false);
    if (!res.ok) {
      const msg = res.message ?? t("auth.setPasswordFailed", "Could not set password.");
      setErr(msg);
      toast.error(msg);
      return;
    }
    toast.success(t("auth.passwordSet", "Password saved."));
    const role = authIntent?.role;
    setAuthIntent(null);
    if (role === "provider") {
      nav({ to: "/pro/onboarding", replace: true });
    } else {
      // Real `profiles.full_name` check — replaces the old Zustand
      // `profile.name` flag (ROUTE-02 / STATE-01).
      const { data: { user } } = await supabase.auth.getUser();
      const { data: prof } = user
        ? await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
        : { data: null };
      nav({ to: prof?.full_name ? "/home" : "/setup", replace: true });
    }
  };

  const Rule = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className={`flex items-center gap-2 text-xs ${ok ? "text-emerald-600" : "text-muted-foreground"}`}>
      <Check className={`h-3.5 w-3.5 ${ok ? "opacity-100" : "opacity-40"}`} />
      {label}
    </div>
  );

  return (
    <PhoneFrame bg="bg-surface">
      <TopBar />
      <div className="flex-1 px-6 pt-2">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("auth.setPasswordTitle", "Set a password")}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {t("auth.setPasswordBody", "You'll use this to sign in next time.")}
        </p>

        <label className="mt-8 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("auth.password", "Password")}
        </label>
        <div className="mt-2 flex h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 focus-within:border-navy">
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            placeholder="••••••••"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground/60"
          />
          <button onClick={() => setShow((v) => !v)} aria-label="toggle password" className="text-muted-foreground">
            {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>

        <div className="mt-4 space-y-1.5">
          <Rule ok={longEnough} label={t("auth.ruleLenStrong", "At least 8 characters")} />
        </div>


        {err && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        )}
      </div>
      <div className="safe-bottom px-6 pt-4">
        <PrimaryButton onClick={submit} disabled={!valid || loading}>
          {loading ? t("common.saving", "Saving…") : t("common.save")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}
