import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
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
import { subscribeToPush } from "@/lib/push";
import {
  clearCustomerPushPromptPending,
  dismissPushPrompt,
  type PushPromptAudience,
} from "@/lib/push-prompt";
import { useRegisterPushSubscription } from "@/lib/db/queries";

type Props = {
  open: boolean;
  audience: PushPromptAudience;
  onOpenChange: (open: boolean) => void;
};

export function PushEnablePrompt({ open, audience, onOpenChange }: Props) {
  const { t } = useTranslation();
  const registerPush = useRegisterPushSubscription();
  const [busy, setBusy] = useState(false);

  const close = () => onOpenChange(false);

  const handleDismiss = () => {
    dismissPushPrompt();
    if (audience === "customer") clearCustomerPushPromptPending();
    close();
  };

  const handleEnable = async () => {
    setBusy(true);
    try {
      const payload = await subscribeToPush();
      await registerPush.mutateAsync(payload);
      dismissPushPrompt();
      if (audience === "customer") clearCustomerPushPromptPending();
      toast.success(t("notifPrefs.pushEnabled"));
      close();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === "denied") toast.error(t("notifPrefs.pushDenied"));
      else if (message !== "dismissed") toast.error(message || t("notifPrefs.pushFailed"));
      if (message === "denied" || message === "dismissed") handleDismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleDismiss())}>
      <AlertDialogContent className="max-w-sm rounded-3xl">
        <AlertDialogHeader>
          <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand">
            <Bell className="h-6 w-6" aria-hidden="true" />
          </div>
          <AlertDialogTitle className="text-center">{t("pushPrompt.title")}</AlertDialogTitle>
          <AlertDialogDescription className="text-center text-sm">
            {audience === "provider" ? t("pushPrompt.bodyProvider") : t("pushPrompt.bodyCustomer")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void handleEnable();
            }}
            className="w-full rounded-2xl bg-brand font-extrabold"
          >
            {busy ? t("notifPrefs.enabling") : t("pushPrompt.enable")}
          </AlertDialogAction>
          <AlertDialogCancel
            disabled={busy}
            onClick={handleDismiss}
            className="w-full rounded-2xl border-0"
          >
            {t("pushPrompt.notNow")}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
