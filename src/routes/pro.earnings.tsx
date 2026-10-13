import { WorkMoney } from "@/components/provider/WorkMoney";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { formatDate } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { PageHeader } from "@/components/famio/PageHeader";
import { Card } from "@/components/famio/ui";
import { useLang } from "@/components/famio/LanguageToggle";
import { useMyProvider, useProviderBookings, useProviderEarnings } from "@/lib/db/provider-queries";
import {
  earningsHeadlineKind,
  isCommissionSnapshotted,
  providerBookingValue,
  type EarningsBucket,
} from "@/lib/earnings/aggregateProviderEarnings";
import { formatEGP } from "@/lib/utils";

export const Route = createFileRoute("/pro/earnings")({ component: EarningsPage });

function SplitAmounts({
  bucket,
  hasNet,
  hasBookingValue,
}: {
  bucket: EarningsBucket | undefined;
  hasNet: boolean;
  hasBookingValue: boolean;
}) {
  const { t } = useTranslation();
  const kind = earningsHeadlineKind(hasNet, hasBookingValue);
  const net = bucket?.net ?? 0;
  const bookingValue = bucket?.bookingValue ?? 0;
  return (
    <div className="mt-2 space-y-2">
      {kind !== "bookingValue" && (
        <div>
          <div className="text-pro-12 text-muted-foreground">{t("pro.earnings.yourNet")}</div>
          <WorkMoney amount={net} />
        </div>
      )}
      {(kind === "bookingValue" || kind === "mixed") && (
        <div>
          <div className="text-pro-12 text-muted-foreground">{t("pro.earnings.bookingValue")}</div>
          <WorkMoney amount={bookingValue} />
        </div>
      )}
    </div>
  );
}

function EarningsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const dateLoc = lang === "ar" ? "ar-EG" : "en-US";
  const p = useMyProvider();
  const provider = p.data as any;
  const e = useProviderEarnings(provider?.id);
  const bookingsQ = useProviderBookings(provider?.id);
  const completed = (bookingsQ.data ?? [])
    .filter((b: any) => b.status === "completed")
    .sort((a: any, b: any) => +new Date(b.start_at) - +new Date(a.start_at))
    .slice(0, 20);

  const capturedKind = earningsHeadlineKind(
    e.data?.hasSnapshottedCaptured ?? false,
    e.data?.hasUnsnapshottedCaptured ?? false,
  );

  const heroAmount =
    capturedKind === "bookingValue"
      ? (e.data?.captured.bookingValue ?? 0)
      : (e.data?.captured.net ?? 0);

  const hasUnrecordedCommission =
    e.data?.hasUnsnapshottedCaptured ||
    e.data?.hasUnsnapshottedUpcoming ||
    completed.some((b: any) => !isCommissionSnapshotted(b));

  return (
    <ProviderShell>
      <PageHeader title={t("pro.earnings.title")} />
      <div className="space-y-3 px-5 pb-6 pt-2">
        <section className="rounded-2xl bg-brand p-5 text-brand-foreground">
          <h2 className="mb-2 text-pro-18 font-extrabold">{t("proRound2.paid")}</h2>
          <p className="text-pro-14 font-bold">
            {capturedKind === "bookingValue"
              ? t("pro.earnings.bookingValue")
              : t("pro.earnings.yourNet")}
          </p>
          <p className="mt-2 whitespace-nowrap text-pro-32 font-extrabold">
            {formatEGP(heroAmount)}
          </p>
          {capturedKind === "mixed" && (
            <p className="mt-2 text-pro-13">
              {t("pro.earnings.bookingValue")}:{" "}
              <span className="whitespace-nowrap font-bold">
                {formatEGP(e.data?.captured.bookingValue ?? 0)}
              </span>
            </p>
          )}
          <p className="mt-2 text-pro-12">
            {t("pro.earnings.fromCompleted", { count: e.data?.completedCount ?? 0 })}
          </p>
        </section>
        <div className="grid grid-cols-2 gap-3">
          <Card className="min-w-0 p-3">
            <h2 className="text-pro-13 font-bold">{t("proWork.thisMonth")}</h2>
            <SplitAmounts
              bucket={e.data?.mtd}
              hasNet={(e.data?.mtd.net ?? 0) > 0}
              hasBookingValue={(e.data?.mtd.bookingValue ?? 0) > 0}
            />
          </Card>
          <Card className="min-w-0 p-3">
            <h2 className="text-pro-13 font-bold">{t("proWork.last7")}</h2>
            <SplitAmounts
              bucket={e.data?.last7}
              hasNet={(e.data?.last7.net ?? 0) > 0}
              hasBookingValue={(e.data?.last7.bookingValue ?? 0) > 0}
            />
          </Card>
        </div>
        <Card className="p-3">
          <h2 className="text-pro-13 font-bold">{t("proRound2.upcomingWork")}</h2>
          <SplitAmounts
            bucket={e.data?.upcoming}
            hasNet={e.data?.hasSnapshottedUpcoming ?? false}
            hasBookingValue={e.data?.hasUnsnapshottedUpcoming ?? false}
          />
          <p className="mt-1 text-pro-12 text-muted-foreground">
            {t("proRound2.upcomingWorkCaption")}
          </p>
        </Card>
        {hasUnrecordedCommission && (
          <p className="text-pro-12 text-muted-foreground">
            {t("pro.earnings.commissionUnrecorded")}
          </p>
        )}
        <section>
          <h2 className="mb-2 text-pro-14 font-extrabold">{t("pro.earnings.recentPayouts")}</h2>
          {completed.length === 0 ? (
            <p className="py-6 text-center text-pro-14 text-muted-foreground">
              {t("pro.earnings.noPayoutsBody")}
            </p>
          ) : (
            <div className="divide-y divide-border/50 rounded-2xl bg-surface px-3">
              {completed.map((b: any) => {
                const name = b.customer?.full_name || t("pro.common.customer");
                const sname =
                  lang === "ar"
                    ? (b.service?.name_ar ?? b.service?.name_en)
                    : (b.service?.name_en ?? b.service?.name_ar);
                const snapshotted = isCommissionSnapshotted(b);
                const bookingValue = providerBookingValue(b);
                return (
                  <div key={b.id} className="flex items-center gap-3 py-3">
                    <ProfileAvatar
                      src={b.customer?.avatar_url}
                      name={name}
                      className="h-11 w-11 rounded-full"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-pro-14 font-bold">{name}</p>
                      <p className="mt-1 text-pro-12 text-muted-foreground">
                        {sname} ·{" "}
                        {formatDate(
                          new Date(b.start_at),
                          { day: "numeric", month: "short" },
                          dateLoc,
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="whitespace-nowrap text-pro-14 font-extrabold">
                        {formatEGP(snapshotted ? Number(b.price_provider_net) : bookingValue)}
                      </p>
                      <p className="text-pro-12 text-muted-foreground">
                        {snapshotted ? t("pro.earnings.yourNet") : t("pro.earnings.bookingValue")}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </ProviderShell>
  );
}
