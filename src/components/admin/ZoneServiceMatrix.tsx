import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAdminZones, useSetZoneService } from "@/lib/db/admin-queries";
import { isQaCatalogService } from "@/lib/catalog/qaCatalog";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

type MatrixService = {
  id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  online_allowed: boolean | null;
  category: { slug: string | null } | null;
};

const ALL_ZONE_SERVICES_KEY = ["admin", "zone-services", "all"] as const;

function useMatrixServices() {
  return useQuery({
    queryKey: ["admin", "zone-matrix-services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, slug, name_en, name_ar, online_allowed, category:categories(slug)")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("name_en");
      if (error) throw error;
      return ((data ?? []) as unknown as MatrixService[]).filter((s) => !isQaCatalogService(s));
    },
  });
}

function useAllZoneServices() {
  return useQuery({
    queryKey: ALL_ZONE_SERVICES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from("zone_services").select("zone_id, service_id");
      if (error) throw error;
      return new Set((data ?? []).map((r) => `${r.zone_id}:${r.service_id}`));
    },
  });
}

/**
 * Zones × services for at-home work. A zone may start with no at-home service
 * at all; online lessons need no zone and run across Egypt.
 */
export function ZoneServiceMatrix() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const zonesQ = useAdminZones();
  const servicesQ = useMatrixServices();
  const cellsQ = useAllZoneServices();
  const setService = useSetZoneService();
  const ar = i18n.language.startsWith("ar");
  const name = (row: { name_ar: string; name_en: string }) => (ar ? row.name_ar : row.name_en);

  const queries = [zonesQ, servicesQ, cellsQ];
  if (queries.some((q) => q.isError)) {
    return (
      <AdminQueryError
        message={t("admin.zones.loadError")}
        onRetry={() => queries.forEach((q) => void q.refetch())}
      />
    );
  }
  if (queries.some((q) => q.isLoading)) return <p className="text-sm">{t("common.loading")}</p>;

  const zones = (zonesQ.data ?? []) as { id: string; name_ar: string; name_en: string; is_active: boolean }[];
  const services = servicesQ.data ?? [];
  const cells = cellsQ.data ?? new Set<string>();

  return (
    <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-sm">
      <h2 className="text-sm font-extrabold">{t("onlineNationwide.adminMatrixTitle")}</h2>
      <p className="text-xs text-muted-foreground">{t("onlineNationwide.adminMatrixHint")}</p>
      {zones.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("onlineNationwide.adminMatrixEmpty")}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky start-0 bg-surface px-2 py-2 text-start font-bold">
                  {t("admin.layout.nav.zones")}
                </th>
                {services.map((s) => (
                  <th key={s.id} scope="col" className="min-w-24 px-2 py-2 text-center font-bold">
                    {name(s)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} className={z.is_active ? "" : "opacity-60"}>
                  <th
                    scope="row"
                    className="sticky start-0 border-t border-border bg-surface px-2 py-2 text-start font-bold"
                  >
                    {name(z)}
                  </th>
                  {services.map((s) => {
                    const on = cells.has(`${z.id}:${s.id}`);
                    return (
                      <td key={s.id} className="border-t border-border px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          aria-label={`${name(z)} – ${name(s)}`}
                          checked={on}
                          disabled={setService.isPending}
                          onChange={(e) =>
                            setService.mutate(
                              { zoneId: z.id, serviceId: s.id, enabled: e.target.checked },
                              {
                                onError: (err: unknown) =>
                                  toast.error(
                                    (err as { message?: string })?.message ??
                                      t("admin.cancellationReasons.genericError"),
                                  ),
                                onSettled: () =>
                                  void qc.invalidateQueries({ queryKey: ALL_ZONE_SERVICES_KEY }),
                              },
                            )
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
