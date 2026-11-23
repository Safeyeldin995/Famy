import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAdminProviderStatement } from "@/lib/db/admin-daily-ops-queries";
import { formatEGP } from "@/lib/utils";
import { bookingCode } from "@/components/admin/operations";
import { useLang } from "@/components/famio/LanguageToggle";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

export function AdminProviderStatementPrint({
  providerId,
  from,
  to,
}: {
  providerId: string;
  from: string;
  to: string;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const q = useAdminProviderStatement(providerId, from, to);
  const labels = useMemo(
    () => ({
      kindLabels: {
        online_provider_share: t("admin.statement.kind.online_provider_share"),
        cash_collected_platform_share: t("admin.statement.kind.cash_collected_platform_share"),
        payout_sent: t("admin.statement.kind.payout_sent"),
        debt_payment_received: t("admin.statement.kind.debt_payment_received"),
        adjustment: t("admin.statement.kind.adjustment"),
        cancellation_fee_provider_share: t("admin.statement.kind.cancellation_fee_provider_share"),
        carried_fee_collected: t("admin.statement.kind.carried_fee_collected"),
      } as Record<string, string>,
    }),
    [t],
  );

  useEffect(() => {
    if (!q.data || q.isLoading || q.isError) return;
    const id = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(id);
  }, [q.data, q.isLoading, q.isError]);

  if (q.isLoading) return <p className="p-6">{t("common.loading")}</p>;
  if (q.isError) {
    return (
      <div className="p-6">
        <AdminQueryError message={t("admin.statement.loadError")} onRetry={() => q.refetch()} />
      </div>
    );
  }
  const data = q.data!;

  return (
    <div
      dir={lang.startsWith("ar") ? "rtl" : "ltr"}
      className={`statement-print bg-white p-6 text-sm text-black ${lang.startsWith("ar") ? "font-arabic" : ""}`}
    >
      <style>{`
        @media print { body { margin: 0; } .statement-print { padding: 12px; } }
        .font-arabic { font-family: var(--font-arabic), "Almarai", Tahoma, sans-serif; }
      `}</style>
      <h1 className="text-lg font-bold">{t("admin.statement.title")}</h1>
      <p className="mt-2 font-semibold">{data.provider_name}</p>
      <p className="text-xs text-gray-600">
        {new Date(data.period_from).toLocaleString(lang, { timeZone: "Africa/Cairo" })} —{" "}
        {new Date(data.period_to).toLocaleString(lang, { timeZone: "Africa/Cairo" })}
      </p>
      <div className="mt-4 flex gap-6 text-sm">
        <p>
          {t("admin.statement.opening")}: <strong>{formatEGP(data.opening_balance)}</strong>
        </p>
        <p>
          {t("admin.statement.closing")}: <strong>{formatEGP(data.closing_balance)}</strong>
        </p>
      </div>
      <table className="mt-4 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b">
            <th className="p-1 text-start">{t("admin.statement.colDate")}</th>
            <th className="p-1 text-start">{t("admin.statement.colKind")}</th>
            <th className="p-1 text-start">{t("admin.statement.colBooking")}</th>
            <th className="p-1 text-start">{t("admin.statement.colDebit")}</th>
            <th className="p-1 text-start">{t("admin.statement.colCredit")}</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id} className="border-b border-gray-200">
              <td className="p-1 whitespace-nowrap">
                {new Date(row.created_at).toLocaleString(lang, { timeZone: "Africa/Cairo" })}
              </td>
              <td className="p-1">{labels.kindLabels[row.kind] ?? row.kind}</td>
              <td className="p-1">
                {row.booking_id ? <bdi dir="ltr">{bookingCode(row.booking_id)}</bdi> : "—"}
              </td>
              <td className="p-1 tabular-nums">
                {row.direction === "debit" ? formatEGP(row.amount) : "—"}
              </td>
              <td className="p-1 tabular-nums">
                {row.direction === "credit" ? formatEGP(row.amount) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}