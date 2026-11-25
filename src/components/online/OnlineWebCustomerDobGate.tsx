import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PrimaryButton } from "@/components/famio/ui";
import { useMyProfile, useUpdateProfileDateOfBirth } from "@/lib/db/queries";
import { memberAgeFromDate, memberToday } from "@/lib/familyMemberAge";
import { ONLINE_BOOKING_MIN_AGE_YEARS } from "@/lib/online/onlineBookingLearnerAge";

type Props = {
  children: ReactNode;
};

export function OnlineWebCustomerDobGate({ children }: Props) {
  const { t } = useTranslation();
  const profileQ = useMyProfile();
  const saveDob = useUpdateProfileDateOfBirth();
  const [dob, setDob] = useState("");

  if (profileQ.isLoading) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }

  const existingDob =
    (profileQ.data as { date_of_birth?: string | null } | null | undefined)?.date_of_birth ?? null;
  if (existingDob) {
    const age = memberAgeFromDate(existingDob);
    if (age && age.years >= ONLINE_BOOKING_MIN_AGE_YEARS) {
      return <>{children}</>;
    }
    return (
      <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.request.dobTooYoung")}</p>
    );
  }

  const submit = async () => {
    if (!dob || saveDob.isPending) return;
    const age = memberAgeFromDate(dob, memberToday());
    if (!age) {
      toast.error(t("onlineWeb.request.dobInvalid"));
      return;
    }
    if (age.years < ONLINE_BOOKING_MIN_AGE_YEARS) {
      toast.error(t("onlineWeb.request.dobTooYoung"));
      return;
    }
    try {
      await saveDob.mutateAsync({ date_of_birth: dob });
      toast.success(t("onlineWeb.request.dobSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
      <p className="text-pro-14 leading-relaxed text-foreground">{t("onlineWeb.request.dobLead")}</p>
      <label className="block">
        <span className="text-pro-13 font-bold text-muted-foreground">{t("onlineWeb.request.dobLabel")}</span>
        <input
          type="date"
          value={dob}
          max={memberToday()}
          onChange={(e) => setDob(e.target.value)}
          className="mt-2 w-full rounded-2xl border border-border bg-white p-3 text-pro-14"
        />
      </label>
      <PrimaryButton className="h-11 w-full" disabled={!dob || saveDob.isPending} onClick={() => void submit()}>
        {t("onlineWeb.request.dobContinue")}
      </PrimaryButton>
    </div>
  );
}