import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PrimaryButton } from "@/components/famio/ui";
import { OnlineAuthCard, OnlinePasswordField } from "@/components/online/OnlineWebAuthParts";
import { supabase } from "@/integrations/supabase/client";
import { emailAuthErrorCode, emailAuthErrorKey, ONLINE_PASSWORD_MIN_LENGTH } from "@/lib/auth/onlineWebAuth";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

export const Route = createFileRoute("/online/reset-password")({ component: OnlineResetPassword });

/** Opened from the password reset email: the link signs the user in for recovery. */
function OnlineResetPassword() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setState(data.session ? "ready" : "invalid");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= ONLINE_PASSWORD_MIN_LENGTH && confirm === password;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error(t(emailAuthErrorKey(emailAuthErrorCode(error))));
      return;
    }
    toast.success(t("onlineWeb.auth.passwordUpdated"));
    nav({ to: ONLINE_WEB_ROUTE_IDS.tutors, replace: true });
  };

  if (state === "checking") {
    return (
      <OnlineAuthCard>
        <div className="grid place-items-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden />
        </div>
      </OnlineAuthCard>
    );
  }

  if (state === "invalid") {
    return (
      <OnlineAuthCard>
        <h1 className="text-pro-24 font-extrabold">{t("onlineWeb.auth.resetInvalidTitle")}</h1>
        <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.auth.resetInvalidBody")}</p>
        <Link
          to={ONLINE_WEB_ROUTE_IDS.forgotPassword}
          className="focus-ring inline-flex min-h-11 items-center text-pro-14 font-extrabold text-brand"
        >
          {t("onlineWeb.auth.sendResetLink")}
        </Link>
      </OnlineAuthCard>
    );
  }

  return (
    <OnlineAuthCard>
      <div>
        <h1 className="text-pro-24 font-extrabold">{t("onlineWeb.auth.resetTitle")}</h1>
        <p className="mt-2 text-pro-14 text-muted-foreground">{t("onlineWeb.auth.resetLead")}</p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <OnlinePasswordField
          id="online-reset-password"
          label={t("onlineWeb.auth.newPassword")}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={t("onlineWeb.auth.passwordRule", { min: ONLINE_PASSWORD_MIN_LENGTH })}
        />
        <OnlinePasswordField
          id="online-reset-password-confirm"
          label={t("onlineWeb.auth.confirmPassword")}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          hint={mismatch ? t("onlineWeb.auth.passwordMismatch") : undefined}
        />
        <PrimaryButton type="submit" disabled={!valid || saving} className="h-12 w-full">
          {saving ? t("common.saving") : t("onlineWeb.auth.savePassword")}
        </PrimaryButton>
      </form>
    </OnlineAuthCard>
  );
}
