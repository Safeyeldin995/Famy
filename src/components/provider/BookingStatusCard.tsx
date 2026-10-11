import { useTranslation } from "react-i18next";
import { BookingTimeline, StatusPill } from "@/components/famio/ui";
import { bookingStatusStep } from "@/lib/provider/workScreenPresentation";

export function BookingStatusCard({ status }: { status: string }) {
  const { t } = useTranslation();
  const step = bookingStatusStep(status);
  return (
    <section className="rounded-2xl border border-border/50 bg-surface px-4 py-3">
      <StatusPill
        tone={status === "completed" ? "success" : status === "pending" ? "warning" : "brand"}
      >
        {t(`pro.statuses.${status}`, { defaultValue: status })}
      </StatusPill>
      {step.next && (
        <p className="mt-1 text-pro-13 text-muted-foreground">
          {t("proWork.nextStep", { step: t(`pro.booking.timeline.${step.next}`) })}
        </p>
      )}
      {step.index >= 0 && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-pro-12 font-bold text-brand">
            {t("proWork.allSteps")}
          </summary>
          <BookingTimeline
            status={status}
            labelFor={(value) => t(`pro.booking.timeline.${value}`)}
          />
        </details>
      )}
    </section>
  );
}
