import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Smartphone, Trash2 } from "lucide-react";
import { Card } from "@/components/famio/ui";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  useMyPushSubscriptions,
  useRegisterPushSubscription,
  useRevokePushSubscriptionByEndpoint,
  useRevokePushSubscriptionById,
  type NotificationPreferences,
} from "@/lib/db/queries";
import { getPushAvailability, subscribeToPush, unsubscribeFromPush, type PushAvailability } from "@/lib/push";

type ToggleKey = Extract<keyof NotificationPreferences, `${string}_push`>;

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-navy" : "bg-muted"}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-soft transition-all ${on ? "start-[22px]" : "start-0.5"}`} />
    </button>
  );
}

function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export function NotificationPreferencesPanel() {
  const { t } = useTranslation();
  const prefsQ = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();
  const devicesQ = useMyPushSubscriptions();
  const registerPush = useRegisterPushSubscription();
  const revokeByEndpoint = useRevokePushSubscriptionByEndpoint();
  const revokeById = useRevokePushSubscriptionById();
  const [availability, setAvailability] = useState<PushAvailability>(() => getPushAvailability());
  const [enabling, setEnabling] = useState(false);

  const prefs = prefsQ.data;

  const toggle = (key: ToggleKey) => {
    if (!prefs) return;
    updatePrefs.mutate({ [key]: !prefs[key] } as Partial<NotificationPreferences>, {
      onError: (e: any) => toast.error(e?.message ?? t("notifPrefs.saveFailed")),
    });
  };

  const handleEnablePush = async () => {
    setEnabling(true);
    try {
      const payload = await subscribeToPush();
      await registerPush.mutateAsync(payload);
      setAvailability(getPushAvailability());
      toast.success(t("notifPrefs.pushEnabled"));
    } catch (e: any) {
      setAvailability(getPushAvailability());
      if (e?.message === "denied") toast.error(t("notifPrefs.pushDenied"));
      else if (e?.message !== "dismissed") toast.error(e?.message ?? t("notifPrefs.pushFailed"));
    } finally {
      setEnabling(false);
    }
  };

  const handleDisablePush = async () => {
    setEnabling(true);
    try {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) await revokeByEndpoint.mutateAsync(endpoint);
      toast.success(t("notifPrefs.pushDisabled"));
    } catch (e: any) {
      toast.error(e?.message ?? t("notifPrefs.pushFailed"));
    } finally {
      setEnabling(false);
    }
  };

  const categories: { key: ToggleKey; label: string; sub: string }[] = [
    { key: "booking_push", label: t("notifPrefs.bookingUpdates"), sub: t("notifPrefs.bookingUpdatesSub") },
    { key: "chat_push", label: t("notifPrefs.chatMessages"), sub: t("notifPrefs.chatMessagesSub") },
    { key: "reminder_push", label: t("notifPrefs.reminders"), sub: t("notifPrefs.remindersSub") },
    { key: "support_push", label: t("notifPrefs.support"), sub: t("notifPrefs.supportSub") },
    { key: "campaign_push", label: t("notifPrefs.marketing"), sub: t("notifPrefs.marketingSub") },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("notifPrefs.pushSection")}</h2>
        <Card className="p-4">
          {availability === "unconfigured" || availability === "unsupported" ? (
            <p className="text-xs text-muted-foreground">
              {availability === "unsupported" ? t("notifPrefs.pushUnsupported") : t("notifPrefs.pushUnavailable")}
            </p>
          ) : availability === "denied" ? (
            <p className="text-xs text-coral">{t("notifPrefs.pushBlocked")}</p>
          ) : availability === "granted" && (devicesQ.data ?? []).length > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{t("notifPrefs.pushOnThisDevice")}</p>
              <button
                onClick={handleDisablePush}
                disabled={enabling}
                className="shrink-0 rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
              >
                {t("notifPrefs.disable")}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{t("notifPrefs.pushOffDescription")}</p>
              <button
                onClick={handleEnablePush}
                disabled={enabling}
                className="shrink-0 rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
              >
                {enabling ? t("notifPrefs.enabling") : t("notifPrefs.enable")}
              </button>
            </div>
          )}
        </Card>
      </div>

      {(devicesQ.data ?? []).length > 0 && (
        <div>
          <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("notifPrefs.devices")}</h2>
          <Card className="divide-y divide-border">
            {devicesQ.data!.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm">{d.device_label || t("notifPrefs.unknownDevice")}</span>
                </div>
                <button
                  onClick={() => revokeById.mutate(d.id, { onError: (e: any) => toast.error(e?.message ?? t("notifPrefs.saveFailed")) })}
                  disabled={revokeById.isPending}
                  aria-label={t("notifPrefs.removeDevice")}
                  className="shrink-0 text-muted-foreground disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </Card>
        </div>
      )}

      <div>
        <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("notifPrefs.categories")}</h2>
        {prefsQ.isLoading ? (
          <div className="h-32 animate-pulse rounded-3xl bg-surface" />
        ) : (
          <Card className="divide-y divide-border">
            {categories.map((c) => (
              <Row key={c.key} label={c.label} sub={c.sub}>
                <Toggle on={!!prefs?.[c.key]} onClick={() => toggle(c.key)} disabled={updatePrefs.isPending} />
              </Row>
            ))}
          </Card>
        )}
        <p className="mt-2 px-1 text-[11px] text-muted-foreground">{t("notifPrefs.inAppAlwaysOn")}</p>
      </div>
    </div>
  );
}
