import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CancelBookingDialog } from "@/components/famio/ui";
import { useProviderUpdateBookingStatus } from "@/lib/db/provider-queries";
import { useCancelBooking } from "@/lib/db/cancellation-queries";

/** Same mutations, disabled states and decline confirmation as booking detail. */
export function BookingRequestActions({ id }: { id: string }) {
  const { t } = useTranslation();
  const update = useProviderUpdateBookingStatus();
  const cancel = useCancelBooking();
  const [declining, setDeclining] = useState(false);
  const onError = (error: Error) => toast.error(error.message || t("common.somethingWentWrong"));
  return (
    <>
      <div className="grid grid-cols-2 gap-2 border-t border-border/50 p-3">
        <button
          className="focus-ring min-h-11 rounded-xl bg-brand text-pro-14 font-bold text-brand-foreground disabled:opacity-50"
          disabled={update.isPending}
          onClick={() => update.mutate({ id, status: "confirmed" }, { onError })}
        >
          {t("proWork.accept")}
        </button>
        <button
          className="focus-ring min-h-11 rounded-xl border border-border text-pro-14 font-bold text-brand disabled:opacity-50"
          disabled={update.isPending || cancel.isPending}
          onClick={() => setDeclining(true)}
        >
          {t("proWork.decline")}
        </button>
      </div>
      <CancelBookingDialog
        open={declining}
        actorType="provider"
        bookingStatus="pending"
        title={t("pro.booking.declineConfirm")}
        body={t("pro.booking.irreversible")}
        reasonLabel={t("pro.booking.reasonLabel")}
        notePlaceholder={t("pro.booking.reasonPlaceholder")}
        confirmLabel={t("pro.booking.confirm")}
        cancelLabel={t("pro.booking.keep")}
        pending={cancel.isPending}
        onCancel={() => setDeclining(false)}
        onConfirm={(reasonId, note) =>
          cancel.mutate(
            { bookingId: id, reasonId, note },
            { onSuccess: () => setDeclining(false), onError },
          )
        }
      />
    </>
  );
}
