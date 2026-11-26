import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PrimaryButton } from "@/components/famio/ui";
import { PhoneNumberField } from "@/components/famio/PhoneNumberField";
import { OnlineAuthCard, OnlineTextField } from "@/components/online/OnlineWebAuthParts";
import { QueryError } from "@/components/famio/QueryError";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { contactPhoneErrorKey } from "@/lib/auth/oauth";
import { useMyProfile, useUpdateProfile } from "@/lib/db/queries";
import { egyptMobileNationalDigits } from "@/lib/otp/normalizePhone";
import { safeOnlineWebReturnTo } from "@/lib/web/onlineWebSession";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

export const Route = createFileRoute("/online/complete-profile")({
  validateSearch: (search: Record<string, unknown> = {}): { returnTo?: string } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  component: OnlineCompleteProfileRoute,
});

function OnlineCompleteProfileRoute() {
  const { returnTo } = Route.useSearch();
  const target = safeOnlineWebReturnTo(returnTo, ONLINE_WEB_ROUTE_IDS.tutors);
  const nav = useNavigate();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (loading || isAuthenticated) return;
    nav({ to: ONLINE_WEB_ROUTE_IDS.login, search: { returnTo: target }, replace: true });
  }, [loading, isAuthenticated, target, nav]);

  if (loading || !isAuthenticated) return null;
  return <OnlineCompleteProfile returnTo={target} />;
}

/**
 * Students who signed up with email or Google add their name and a contact
 * phone before booking (tutors call the student, and bookings require a phone).
 */
function OnlineCompleteProfile({ returnTo }: { returnTo: string }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const profileQ = useMyProfile();
  const updateProfile = useUpdateProfile();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const existingName = profileQ.data?.full_name?.trim() ?? "";
  const existingPhone = profileQ.data?.phone?.trim() ?? "";

  useEffect(() => {
    if (existingName) setFullName((v) => v || existingName);
  }, [existingName]);

  useEffect(() => {
    if (profileQ.data && existingName && existingPhone) nav({ href: returnTo, replace: true });
  }, [profileQ.data, existingName, existingPhone, returnTo, nav]);

  if (profileQ.isLoading) {
    return (
      <OnlineAuthCard>
        <div className="grid place-items-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden />
        </div>
      </OnlineAuthCard>
    );
  }
  if (profileQ.isError) {
    return (
      <OnlineAuthCard>
        <QueryError onRetry={() => profileQ.refetch()} />
      </OnlineAuthCard>
    );
  }

  const needsPhone = !existingPhone;
  const phoneDigits = egyptMobileNationalDigits(phone);
  const valid = fullName.trim().length > 1 && (!needsPhone || phoneDigits !== null);

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      if (needsPhone && phoneDigits) {
        const { error } = await supabase.rpc("set_my_contact_phone", { p_phone: `0${phoneDigits}` });
        if (error) {
          toast.error(t(contactPhoneErrorKey(error.message)), { duration: 8000 });
          return;
        }
      }
      if (fullName.trim() !== existingName) {
        await updateProfile.mutateAsync({ full_name: fullName.trim() });
      }
      await profileQ.refetch();
      nav({ href: returnTo, replace: true });
    } catch {
      toast.error(t("common.somethingWentWrong"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnlineAuthCard>
      <div>
        <h1 className="text-pro-24 font-extrabold text-balance">
          {t("onlineWeb.auth.completeTitle")}
        </h1>
        <p className="mt-2 text-pro-14 text-muted-foreground">{t("onlineWeb.auth.completeLead")}</p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <OnlineTextField
          id="online-complete-name"
          label={t("onlineWeb.auth.fullName")}
          value={fullName}
          onChange={setFullName}
          autoComplete="name"
          placeholder={t("onlineWeb.auth.fullNameHint")}
        />
        {needsPhone ? (
          <PhoneNumberField
            id="online-complete-phone"
            label={t("oauth.phoneLabel")}
            value={phone}
            onChange={setPhone}
            hint={t("onlineWeb.auth.phoneWhy")}
          />
        ) : null}
        <PrimaryButton type="submit" disabled={!valid || saving} className="h-12 w-full">
          {saving ? t("common.saving") : t("onlineWeb.auth.completeCta")}
        </PrimaryButton>
      </form>
    </OnlineAuthCard>
  );
}
