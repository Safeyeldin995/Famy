import { type ReactNode, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PrimaryButton } from "@/components/famio/ui";
import { useMyProfile } from "@/lib/db/queries";
import { memberAgeFromDate } from "@/lib/familyMemberAge";
import {
  useRequestParentLink,
  useStudentParentLinkStatus,
} from "@/lib/db/student-parent-link-queries";

type Props = {
  children: ReactNode;
};

export function OnlineWebParentLinkGate({ children }: Props) {
  const { t } = useTranslation();
  const profileQ = useMyProfile();
  const statusQ = useStudentParentLinkStatus();
  const request = useRequestParentLink();
  const [phone, setPhone] = useState("");

  if (profileQ.isLoading || statusQ.isLoading) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }

  const dob = (profileQ.data as { date_of_birth?: string | null } | undefined)?.date_of_birth ?? null;
  const age = dob ? memberAgeFromDate(dob)?.years : null;
  if (age == null || age < 12 || age >= 18) {
    return <>{children}</>;
  }

  const link = statusQ.data;
  if (link?.status === "approved") {
    return <>{children}</>;
  }

  const submit = async () => {
    if (!phone.trim() || request.isPending) return;
    try {
      const result = await request.mutateAsync(phone.trim());
      if (result.outcome === "not_on_famy") {
        toast.message(t("studentParentLink.notOnFamy"));
      } else {
        toast.success(t("studentParentLink.requestSent"));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
      <h2 className="text-pro-16 font-extrabold text-foreground">{t("studentParentLink.title")}</h2>
      {link?.status === "pending" ? (
        <p className="text-pro-14 text-muted-foreground">{t("studentParentLink.pending")}</p>
      ) : link?.status === "rejected" ? (
        <p className="text-pro-14 text-muted-foreground">{t("studentParentLink.rejected")}</p>
      ) : (
        <p className="text-pro-14 text-muted-foreground">{t("studentParentLink.lead")}</p>
      )}
      {link?.status !== "pending" ? (
        <>
          <label className="block">
            <span className="text-pro-13 font-bold text-muted-foreground">
              {t("studentParentLink.parentPhone")}
            </span>
            <input
              type="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-border bg-white p-3 text-pro-14"
              placeholder="01XXXXXXXXX"
            />
          </label>
          <PrimaryButton
            className="h-11 w-full"
            disabled={!phone.trim() || request.isPending}
            onClick={() => void submit()}
          >
            {t("studentParentLink.sendRequest")}
          </PrimaryButton>
        </>
      ) : null}
      <p className="text-pro-13 text-muted-foreground">
        <Link to="/online" className="font-bold text-brand underline">
          {t("studentParentLink.appHint")}
        </Link>
      </p>
    </div>
  );
}