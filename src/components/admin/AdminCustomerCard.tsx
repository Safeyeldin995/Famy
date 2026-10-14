import { useTranslation } from "react-i18next";
import { AdminLink } from "./AdminNavigation";
import { AdminStatusBadge } from "./AdminStatusBadge";
import { adminDate } from "./adminPresentation";

export type CustomerCardData = {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  created_at: string;
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  totalSpent: number;
  is_suspended?: boolean;
};
export function AdminCustomerCard({ customer: c }: { customer: CustomerCardData }) {
  const { t, i18n } = useTranslation();
  return (
    <article
      data-admin-customer-card
      className="min-w-0 space-y-3 rounded-xl border p-4 text-sm [overflow-wrap:anywhere]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">{c.full_name || t("admin.provider.unnamed")}</h2>
          <bdi dir="ltr" className="text-xs text-muted-foreground">
            {c.phone || "—"}
          </bdi>
        </div>
        <AdminStatusBadge tone={c.is_suspended ? "danger" : "success"}>
          {c.is_suspended ? t("admin.providers.suspended") : t("admin.customers.active")}
        </AdminStatusBadge>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("admin.customers.registered")}: {adminDate(c.created_at, i18n.language, false)}
      </p>
      <dl className="grid grid-cols-2 gap-3 text-xs">
        {(
          [
            ["totalBookings", c.totalBookings],
            ["completed", c.completedBookings],
            ["cancelled", c.cancelledBookings],
            [
              "totalSpent",
              Number(c.totalSpent || 0).toLocaleString("en-US") +
                (i18n.language.startsWith("ar") ? " ج.م" : " EGP"),
            ],
          ] as const
        ).map(([key, value]) => (
          <div key={key}>
            <dt className="text-muted-foreground">{t("admin.customers." + key)}</dt>
            <dd className="mt-1 text-sm font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <AdminLink
        to="/admin/customer/$id"
        params={{ id: c.id }}
        className="flex min-h-11 items-center justify-center rounded-xl border text-sm font-bold text-brand"
      >
        {t("admin.customers.view")}
      </AdminLink>
    </article>
  );
}
