import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  canRequestUpdatedDetails,
  useAdminOnboardingAction,
  type OnboardingStatus,
} from "@/lib/provider/onboarding-queries";

export function RequestUpdatedDetailsAction({
  providerId,
  onboardingStatus,
  onActionSuccess,
}: {
  providerId: string;
  onboardingStatus: OnboardingStatus | undefined;
  onActionSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const onboardingAction = useAdminOnboardingAction();
  const [open, setOpen] = useState(false);
  const [reasonPublic, setReasonPublic] = useState("");
  const [notesInternal, setNotesInternal] = useState("");

  if (!canRequestUpdatedDetails(onboardingStatus)) return null;

  return (
    <>
      <button
        type="button"
        disabled={onboardingAction.isPending}
        onClick={() => {
          setReasonPublic("");
          setNotesInternal("");
          setOpen(true);
        }}
        className="focus-ring flex-1 rounded-xl border border-border py-3 text-sm font-bold disabled:opacity-50"
      >{t("admin.provider.requestUpdatedDetails")}</button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-3xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-extrabold">{t("admin.provider.requestUpdatedDetails")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("admin.provider.requestUpdatedDetailsBody")}</p>
            <textarea
              value={reasonPublic}
              onChange={(e) => setReasonPublic(e.target.value)}
              rows={3}
              placeholder={t("admin.provider.reasonRequired")}
              aria-label={t("admin.provider.reasonRequired")}
              className="mt-3 w-full resize-none rounded-xl border border-border bg-surface p-2 text-sm"
            />
            <textarea
              value={notesInternal}
              onChange={(e) => setNotesInternal(e.target.value)}
              rows={2}
              placeholder={t("admin.provider.internalNotes")}
              className="mt-2 w-full resize-none rounded-xl border border-border bg-surface p-2 text-xs"
            />
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="focus-ring h-11 flex-1 rounded-2xl border border-border text-sm font-bold">{t("common.cancel")}</button>
              <button
                type="button"
                disabled={!reasonPublic.trim() || onboardingAction.isPending}
                onClick={() => onboardingAction.mutate(
                  {
                    providerId,
                    action: "request_updated_details",
                    reasonCode: "updated_details_required",
                    reasonPublic: reasonPublic.trim(),
                    notesInternal: notesInternal.trim() || undefined,
                  },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      onActionSuccess?.();
                    },
                    onError: (e: any) => toast.error(e?.message ?? t("admin.providers.rejectError")),
                  },
                )}
                className="focus-ring h-11 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground disabled:opacity-50"
              >{t("admin.provider.requestUpdatedDetailsConfirm")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
