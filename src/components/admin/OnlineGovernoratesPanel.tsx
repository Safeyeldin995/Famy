import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useOnlineAvailabilitySettings,
  useUpdateOnlineAvailability,
} from "@/lib/db/settings-queries";
import { EGYPT_GOVERNORATES, governorateName } from "@/lib/geo/egyptGovernorates";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

/** Online lessons are open across Egypt; an admin can close a governorate. */
export function OnlineGovernoratesPanel() {
  const { t, i18n } = useTranslation();
  const settings = useOnlineAvailabilitySettings();
  const update = useUpdateOnlineAvailability();

  if (settings.isError) {
    return (
      <AdminQueryError message={t("admin.zones.loadError")} onRetry={() => void settings.refetch()} />
    );
  }
  if (settings.isLoading || !settings.data) return <p className="text-sm">{t("common.loading")}</p>;

  const closed = new Set(settings.data.closed_governorates);
  const toggle = (code: string, open: boolean) => {
    const next = new Set(closed);
    if (open) next.delete(code);
    else next.add(code);
    update.mutate(
      { closed_governorates: [...next] },
      {
        onError: (err: unknown) =>
          toast.error(
            (err as { message?: string })?.message ?? t("admin.cancellationReasons.genericError"),
          ),
      },
    );
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-sm">
      <h2 className="text-sm font-extrabold">{t("onlineNationwide.adminOnlineTitle")}</h2>
      <p className="text-xs text-muted-foreground">{t("onlineNationwide.adminOnlineHint")}</p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {EGYPT_GOVERNORATES.map((g) => {
          const label = governorateName(g.code, i18n.language);
          const open = !closed.has(g.code);
          return (
            <li key={g.code}>
              <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                <span className="font-bold">{label}</span>
                <span className="flex items-center gap-2">
                  <span className={`text-xs ${open ? "text-success" : "text-destructive"}`}>
                    {open ? t("onlineNationwide.adminOnlineOpen") : t("onlineNationwide.adminOnlineClosed")}
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="h-5 w-5"
                    aria-label={t("onlineNationwide.adminOnlineToggle", { name: label })}
                    checked={open}
                    disabled={update.isPending}
                    onChange={(e) => toggle(g.code, e.target.checked)}
                  />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
