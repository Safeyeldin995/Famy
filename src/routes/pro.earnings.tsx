import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { ProviderPageHero } from "@/components/famio/ProviderPageHero";
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
import { TrendingUp, CheckCircle2, Clock4 } from "lucide-react";

export const Route = createFileRoute("/pro/earnings")({ component: EarningsPage });

function SplitAmounts({
  bucket,
  hasNet,
  hasBookingValue,
  netLabel,
  bookingLabel,
  note,
}: {
  bucket: EarningsBucket | undefined;
  hasNet: boolean;
  hasBookingValue: boolean;
  netLabel: string;
  bookingLabel: string;
  note?: string;
}) {
  const kind = earningsHeadlineKind(hasNet, hasBookingValue);
  const net = bucket?.net ?? 0;
  const bookingValue = bucket?.bookingValue ?? 0;
  if (kind === "mixed") {
    return (
      <div className="mt-3 space-y-3">
        <div>
          <div className="text-[11px] font-bold text-muted-foreground">{netLabel}</div>
          <div className="mt-1 text-2xl font-black text-foreground">{formatEGP(net)}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold text-muted-foreground">{bookingLabel}</div>
          <div className="mt-1 text-2xl font-black text-foreground">{formatEGP(bookingValue)}</div>
        </div>
      </div>
    );
  }
  if (kind === "bookingValue") {
    return (
      <div>
        <div className="mt-3 text-2xl font-black text-foreground">{formatEGP(bookingValue)}</div>
        {note ? (
          <div className="mt-1 text-[11px] font-medium text-muted-foreground">{note}</div>
        ) : null}
      </div>
    );
  }
  return <div className="mt-3 text-2xl font-black text-foreground">{formatEGP(net)}</div>;
}

function periodLabel(
  t: (key: string) => string,
  kind: ReturnType<typeof earningsHeadlineKind>,
  netKey: string,
  bookingKey: string,
  fallbackKey: string,
) {
  if (kind === "bookingValue") return t(bookingKey);
  if (kind === "net") return t(netKey);
  return t(fallbackKey);
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
  const mtdKind = earningsHeadlineKind(
    (e.data?.mtd.net ?? 0) > 0 || (e.data?.hasSnapshottedCaptured ?? false),
    (e.data?.mtd.bookingValue ?? 0) > 0 || (e.data?.hasUnsnapshottedCaptured ?? false),
  );
  const last7Kind = earningsHeadlineKind(
    (e.data?.last7.net ?? 0) > 0,
    (e.data?.last7.bookingValue ?? 0) > 0,
  );
  const upcomingKind = earningsHeadlineKind(
    e.data?.hasSnapshottedUpcoming ?? false,
    e.data?.hasUnsnapshottedUpcoming ?? false,
  );

  const heroAmount =
    capturedKind === "bookingValue"
      ? (e.data?.captured.bookingValue ?? 0)
      : (e.data?.captured.net ?? 0);

  return (
    <ProviderShell>
      <ProviderPageHero title={t("pro.earnings.title")} compact />

      <div className="space-y-5 px-5 pb-28 pt-2">
        {capturedKind === "mixed" ? (
          <div className="grid grid-cols-1 gap-3">
            <div className="flex flex-col justify-between rounded-[1.25rem] bg-brand p-5 text-brand-foreground shadow-sm">
              <div className="text-sm font-bold opacity-80 uppercase tracking-widest">
                {t("pro.earnings.yourNet")}
              </div>
              <div className="mt-2 text-[2.5rem] font-black leading-none">
                {formatEGP(e.data?.captured.net ?? 0)}
              </div>
            </div>
            <div className="rounded-[1.25rem] border border-border/60 bg-surface p-5 shadow-sm">
              <div className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                {t("pro.earnings.bookingValue")}
              </div>
              <div className="mt-2 text-[2rem] font-black leading-none">
                {formatEGP(e.data?.captured.bookingValue ?? 0)}
              </div>
              <div className="mt-2 text-[11px] font-medium text-muted-foreground">
                {t("pro.earnings.commissionUnrecorded")}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col justify-between rounded-[1.25rem] bg-brand p-5 text-brand-foreground shadow-sm">
            <div>
              <div className="text-sm font-bold opacity-80 uppercase tracking-widest">
                {capturedKind === "bookingValue"
                  ? t("pro.earnings.bookingValue")
                  : t("pro.earnings.yourNet")}
              </div>
              <div className="mt-2 text-[2.5rem] font-black leading-none">
                {formatEGP(heroAmount)}
              </div>
              {capturedKind === "bookingValue" ? (
                <div className="mt-2 text-[11px] font-medium opacity-90">
                  {t("pro.earnings.commissionUnrecorded")}
                </div>
              ) : null}
            </div>
            <div className="mt-6 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-white/40" />
              <div className="text-xs font-bold opacity-90">
                {t("pro.earnings.fromCompleted", { count: e.data?.completedCount ?? 0 })}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
              <TrendingUp className="h-4 w-4" />{" "}
              {periodLabel(
                t,
                mtdKind,
                "pro.earnings.thisMonthNet",
                "pro.earnings.thisMonthBookingValue",
                "pro.earnings.thisMonth",
              )}
            </div>
            <SplitAmounts
              bucket={e.data?.mtd}
              hasNet={(e.data?.mtd.net ?? 0) > 0}
              hasBookingValue={(e.data?.mtd.bookingValue ?? 0) > 0}
              netLabel={t("pro.earnings.thisMonthNet")}
              bookingLabel={t("pro.earnings.thisMonthBookingValue")}
              note={t("pro.earnings.commissionUnrecorded")}
            />
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
              <Clock4 className="h-4 w-4" />{" "}
              {periodLabel(
                t,
                last7Kind,
                "pro.earnings.last7Net",
                "pro.earnings.last7BookingValue",
                "pro.earnings.last7",
              )}
            </div>
            <SplitAmounts
              bucket={e.data?.last7}
              hasNet={(e.data?.last7.net ?? 0) > 0}
              hasBookingValue={(e.data?.last7.bookingValue ?? 0) > 0}
              netLabel={t("pro.earnings.last7Net")}
              bookingLabel={t("pro.earnings.last7BookingValue")}
              note={t("pro.earnings.commissionUnrecorded")}
            />
          </Card>
        </div>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" />{" "}
            {periodLabel(
              t,
              upcomingKind,
              "pro.earnings.upcomingPipelineNet",
              "pro.earnings.upcomingPipelineBookingValue",
              "pro.earnings.upcomingPipeline",
            )}
          </div>
          <SplitAmounts
            bucket={e.data?.upcoming}
            hasNet={e.data?.hasSnapshottedUpcoming ?? false}
            hasBookingValue={e.data?.hasUnsnapshottedUpcoming ?? false}
            netLabel={t("pro.earnings.upcomingPipelineNet")}
            bookingLabel={t("pro.earnings.upcomingPipelineBookingValue")}
            note={t("pro.earnings.commissionUnrecorded")}
          />
          <div className="mt-1 text-[11px] font-medium text-muted-foreground">
            {upcomingKind === "bookingValue"
              ? t("pro.earnings.upcomingPipelineSubBookingValue")
              : upcomingKind === "net"
                ? t("pro.earnings.upcomingPipelineSubNet")
                : t("pro.earnings.upcomingPipelineSub")}
          </div>
        </Card>

        <div>
          <h2 className="mb-3 px-1 text-sm font-extrabold tracking-tight text-foreground">
            {t("pro.earnings.recentPayouts")}
          </h2>
          {completed.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-border/60 p-8 text-center">
              <p className="text-sm font-bold text-muted-foreground">
                {t("pro.earnings.noPayoutsBody")}
              </p>
            </div>
          ) : (
            <Card className="divide-y divide-border/50 noPad">
              {completed.map((b: any) => {
                const sname =
                  lang === "ar"
                    ? (b.service?.name_ar ?? b.service?.name_en)
                    : (b.service?.name_en ?? b.service?.name_ar);
                const snapshotted = isCommissionSnapshotted(b);
                const bookingValue = providerBookingValue(b);
                return (
                  <div key={b.id} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-extrabold text-foreground">
                          {b.customer?.full_name || t("pro.common.customer")}
                        </div>
                        <div className="mt-0.5 text-xs font-bold text-muted-foreground">
                          {sname} · {new Date(b.start_at).toLocaleDateString(dateLoc)}
                        </div>
                      </div>
                      <div className="text-end">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                          {snapshotted ? t("pro.earnings.yourNet") : t("pro.earnings.bookingValue")}
                        </div>
                        <div className="text-base font-black text-foreground">
                          {formatEGP(snapshotted ? Number(b.price_provider_net) : bookingValue)}
                        </div>
                      </div>
                    </div>
                    {snapshotted ? (
                      <div className="mt-2 space-y-0.5 text-[11px] font-medium text-muted-foreground">
                        <div className="flex justify-between gap-3">
                          <span>{t("pro.earnings.bookingValue")}</span>
                          <span>{formatEGP(bookingValue)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>
                            {t("pro.earnings.commission", {
                              percent: Number(b.price_commission_percent),
                            })}
                          </span>
                          <span>{formatEGP(Number(b.price_commission_amount ?? 0))}</span>
                        </div>
                        <div className="flex justify-between gap-3 font-bold text-foreground">
                          <span>{t("pro.earnings.netLine")}</span>
                          <span>{formatEGP(Number(b.price_provider_net))}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                        {t("pro.earnings.commissionUnrecorded")}
                      </p>
                    )}
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      </div>
    </ProviderShell>
  );
}
