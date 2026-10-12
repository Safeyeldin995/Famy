import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { BookingExpirySettings } from "@/lib/booking/pending-expiry";
import { bookingCountdownLabel } from "@/lib/provider/workScreenPresentation";
import { isPreviewRoute, PREVIEW_NOW_ISO } from "@/lib/preview/constants";

export function BookingCountdown({
  createdAt,
  startAt,
  settings,
}: {
  createdAt: string;
  startAt: string;
  settings?: BookingExpirySettings;
}) {
  const { t, i18n } = useTranslation();
  const preview = useRouterState({ select: (state) => isPreviewRoute(state.location.pathname) });
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(preview ? new Date(PREVIEW_NOW_ISO) : new Date());
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [preview]);
  const label = now
    ? bookingCountdownLabel(createdAt, startAt, settings, now, i18n.language, t)
    : null;
  return label ? (
    <span
      className="rounded-full bg-warning/10 px-2.5 py-1 text-pro-12 font-bold text-warning"
      data-testid="respond-within"
    >
      {label}
    </span>
  ) : null;
}
