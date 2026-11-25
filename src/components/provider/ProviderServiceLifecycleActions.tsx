import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useRemoveProviderService,
  useSetProviderServiceActive,
} from "@/lib/db/provider-queries";
import type { ProviderServiceRowStatus } from "@/lib/provider/providerServiceGroups";

type ConfirmKind = "pause" | "remove" | null;

export function ProviderServiceLifecycleActions({
  providerId,
  serviceId,
  status,
}: {
  providerId: string;
  serviceId: string;
  status: ProviderServiceRowStatus;
}) {
  const { t } = useTranslation();
  const setActive = useSetProviderServiceActive(providerId);
  const remove = useRemoveProviderService(providerId);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const busy = setActive.isPending || remove.isPending;

  if (status !== "approved" && status !== "paused") return null;

  const runRemove = () => {
    remove.mutate(serviceId, {
      onSuccess: (data) => {
        setConfirm(null);
        if (data.upcoming_bookings > 0) {
          toast.success(t("pro.serviceLifecycle.removeUpcoming", { count: data.upcoming_bookings }));
        } else {
          toast.success(t("pro.serviceLifecycle.removed"));
        }
      },
      onError: () => toast.error(t("common.somethingWentWrong")),
    });
  };

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {status === "approved" ? (
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-lg border border-border px-3 text-xs font-bold disabled:opacity-50"
            onClick={() => setConfirm("pause")}
          >
            {t("pro.serviceLifecycle.pause")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-lg border border-brand px-3 text-xs font-bold text-brand disabled:opacity-50"
            onClick={() =>
              setActive.mutate(
                { serviceId, active: true },
                {
                  onSuccess: () => toast.success(t("pro.serviceLifecycle.resumed")),
                  onError: () => toast.error(t("common.somethingWentWrong")),
                },
              )
            }
          >
            {t("pro.serviceLifecycle.resume")}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded-lg border border-coral px-3 text-xs font-bold text-coral disabled:opacity-50"
          onClick={() => setConfirm("remove")}
        >
          {t("pro.serviceLifecycle.remove")}
        </button>
      </div>
      <AlertDialog open={confirm === "pause"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pro.serviceLifecycle.pauseTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("pro.serviceLifecycle.pauseBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                setActive.mutate(
                  { serviceId, active: false },
                  {
                    onSuccess: () => {
                      setConfirm(null);
                      toast.success(t("pro.serviceLifecycle.paused"));
                    },
                    onError: () => toast.error(t("common.somethingWentWrong")),
                  },
                )
              }
            >
              {t("pro.serviceLifecycle.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirm === "remove"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pro.serviceLifecycle.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("pro.serviceLifecycle.removeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={runRemove}>{t("pro.serviceLifecycle.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}