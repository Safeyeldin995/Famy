import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PrimaryButton } from "@/components/famio/ui";
import { useAuth } from "@/lib/auth/useAuth";
import { useMyProfile } from "@/lib/db/queries";
import { useMyStudentParentLink, useRequestParentLink } from "@/lib/db/student-parent-link-queries";
import { memberAgeFromDate } from "@/lib/familyMemberAge";
import { normalizePhoneE164, isValidE164Phone } from "@/lib/otp/normalizePhone";

type Props = {
  children: ReactNode;
};

export function OnlineWebParentLinkGate({ children }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const profileQ = useMyProfile();
  const linkQ = useMyStudentParentLink(user?.id);
  const request = useRequestParentLink();
  const [phone, setPhone] = useState("");

  const dob = (profileQ.data as { date_of_birth?: string | null } | null)?.date_of_birth ?? null;
  const age = dob ? memberAgeFromDate(dob) : null;
  if (!age || age.years >= 18) {
    return <>{children}</>;
  }

  if (profileQ.isLoading || linkQ.isLoading) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }

  if (linkQ.data?.status === "approved") {
    return <>{children}</>;
  }

  const submit = async () => {
    const normalized = normalizePhoneE164(phone);
    if (!isValidE164Phone(normalized) || !/^\+201[0125]\d{8}$/.test(normalized)) {
      toast.error(t("parentLink.invalidPhone"));
      return;
    }
    try {
      const result = await request.mutateAsync(normalized);
      if (result.parent_found) toast.success(t("onlineWeb.request.parentLinkSent"));
      else toast.success(t("onlineWeb.request.parentLinkNotOnFamy"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("PARENT_LINK_RATE_LIMITED")) toast.error(t("parentLink.rateLimited"));
      else if (message.includes("PARENT_LINK_INVALID_PHONE"))
        toast.error(t("parentLink.invalidPhone"));
      else toast.error(message || t("common.somethingWentWrong"));
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
      <p className="text-pro-14 leading-relaxed text-foreground">
        {t("onlineWeb.request.parentLinkLead")}
      </p>
      {linkQ.data?.status === "pending" ? (
        <p className="text-pro-13 text-muted-foreground">
          {t("onlineWeb.request.parentLinkPending")}
        </p>
      ) : null}
      <label className="block">
        <span className="text-pro-13 font-bold text-muted-foreground">
          {t("onlineWeb.request.parentPhoneLabel")}
        </span>
        <input
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mt-2 w-full rounded-2xl border border-border bg-white p-3 text-pro-14"
          placeholder="01xxxxxxxxx"
        />
      </label>
      <PrimaryButton
        className="h-11 w-full"
        disabled={!phone.trim() || request.isPending}
        onClick={() => void submit()}
      >
        {t("onlineWeb.request.parentPhoneContinue")}
      </PrimaryButton>
    </div>
  );
}
