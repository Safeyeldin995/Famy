import { useMyProfile } from "@/lib/db/queries";
import { useStudentParentLinkStatus } from "@/lib/db/student-parent-link-queries";
import { memberAgeFromDate } from "@/lib/familyMemberAge";
import { useTranslation } from "react-i18next";

export function useOnlineStudentNeedsGuardianContact() {
  const profileQ = useMyProfile();
  const statusQ = useStudentParentLinkStatus();
  const dob = (profileQ.data as { date_of_birth?: string | null } | undefined)?.date_of_birth ?? null;
  const age = dob ? memberAgeFromDate(dob)?.years : null;
  const isMinorStudent = age != null && age >= 12 && age < 18;
  const activeLink = statusQ.data;
  const hasActiveContact =
    activeLink?.status === "notified" ||
    activeLink?.status === "linked" ||
    activeLink?.status === "flagged_not_my_child";
  return {
    loading: profileQ.isLoading || statusQ.isLoading,
    isMinorStudent,
    activeLink,
    needsNewContact: isMinorStudent && !hasActiveContact,
  };
}

type ParentContactFieldsProps = {
  parentPhone: string;
  parentEmail: string;
  onParentPhoneChange: (value: string) => void;
  onParentEmailChange: (value: string) => void;
  disabled?: boolean;
};

export function OnlineWebParentContactFields({
  parentPhone,
  parentEmail,
  onParentPhoneChange,
  onParentEmailChange,
  disabled,
}: ParentContactFieldsProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
      <h2 className="text-pro-16 font-extrabold text-foreground">{t("studentParentLink.title")}</h2>
      <p className="text-pro-14 text-muted-foreground">{t("studentParentLink.bookingStepLead")}</p>
      <label className="block">
        <span className="text-pro-13 font-bold text-muted-foreground">
          {t("studentParentLink.parentPhone")}
        </span>
        <input
          type="tel"
          dir="ltr"
          value={parentPhone}
          disabled={disabled}
          onChange={(e) => onParentPhoneChange(e.target.value)}
          className="mt-2 w-full rounded-2xl border border-border bg-white p-3 text-pro-14"
          placeholder="01XXXXXXXXX"
        />
      </label>
      <label className="block">
        <span className="text-pro-13 font-bold text-muted-foreground">
          {t("studentParentLink.parentEmail")}
        </span>
        <input
          type="email"
          dir="ltr"
          value={parentEmail}
          disabled={disabled}
          onChange={(e) => onParentEmailChange(e.target.value)}
          className="mt-2 w-full rounded-2xl border border-border bg-white p-3 text-pro-14"
          placeholder="parent@email.com"
        />
      </label>
    </section>
  );
}