import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { StatusPill } from "@/components/famio/ui";
import { providerTimelineIndex, PROVIDER_JOURNEY_STEPS } from "@/lib/provider/journeyPresentation";

export function BookingStatusCard({ status }: { status: string }) {
  const { t } = useTranslation();
  const index = providerTimelineIndex(status);
  return (
    <section className="rounded-2xl border border-border/50 bg-surface p-4">
      <StatusPill
        tone={status === "completed" ? "success" : status === "pending" ? "warning" : "brand"}
      >
        {t(`pro.statuses.${status}`, { defaultValue: status })}
      </StatusPill>
      {!["cancelled", "no_show", "disputed"].includes(status) && (
        <ol
          aria-label={t("proWork.allSteps")}
          className="mt-3 space-y-2 border-s-2 border-border ps-3"
        >
          {PROVIDER_JOURNEY_STEPS.map((key, i) => (
            <li
              key={key}
              aria-current={i === index ? "step" : undefined}
              className={`flex items-center gap-2 text-pro-13 ${i <= index ? "font-bold text-brand" : "text-muted-foreground"}`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full ${i <= index ? "bg-brand text-white" : "bg-surface-2"}`}
                aria-hidden="true"
              >
                {i <= index ? <Check size={12} /> : i + 1}
              </span>
              {t(`proRound2.${key}`)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
