import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { QueryError } from "@/components/famio/QueryError";
import { useProPath } from "@/lib/provider/useProPath";
import {
  useProviderUpdateServiceZones,
  useZoneCombinationsCatalog,
} from "@/lib/db/provider-queries";
import { partnerZoneIdsFor } from "@/lib/geo/zoneCombinations";

export function ProfileWorkZones({
  providerId,
  applicationEditable,
}: {
  providerId: string;
  applicationEditable: boolean;
}) {
  const { t, i18n } = useTranslation();
  const proPath = useProPath();
  const combinationsQ = useZoneCombinationsCatalog();
  const updateZones = useProviderUpdateServiceZones();
  const [pickSecondId, setPickSecondId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["provider-work-zone-names", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zone_providers")
        .select("zone_id, zone:zones(id, name_ar, name_en, is_active)")
        .eq("provider_id", providerId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const activeZonesQ = useQuery({
    queryKey: ["active-zones-labels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zones")
        .select("id, name_ar, name_en, is_active")
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = query.data ?? [];
  const primary = rows[0];
  const primaryId = primary?.zone_id;
  const names = rows
    .map(({ zone }) => (i18n.language.startsWith("ar") ? zone?.name_ar : zone?.name_en))
    .filter(Boolean);
  const secondOptions = useMemo(() => {
    if (!primaryId || applicationEditable) return [];
    const partnerIds = new Set(partnerZoneIdsFor(primaryId, combinationsQ.data ?? []));
    const taken = new Set(rows.map((r) => r.zone_id));
    return (activeZonesQ.data ?? []).filter((z) => partnerIds.has(z.id) && !taken.has(z.id));
  }, [primaryId, applicationEditable, combinationsQ.data, activeZonesQ.data, rows]);

  const addSecondZone = async () => {
    if (!primaryId || !pickSecondId) return;
    try {
      await updateZones.mutateAsync({ primaryZoneId: primaryId, secondaryZoneId: pickSecondId });
      setPickSecondId(null);
      toast.success(t("providerLocations.secondZoneAdded"));
      await query.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? t("providerLocations.secondZoneError"));
    }
  };

  return (
    <div className="apply-li flex-wrap">
      <dt className="font-bold">{t("providerLocations.worksIn")}</dt>
      <dd className="min-w-0 flex-1 text-end">
        {query.isError ? (
          <QueryError
            compact
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : query.isPending ? (
          <span role="status">{t("common.loading")}</span>
        ) : (
          <>
            <span>
              {names.length
                ? names.join(i18n.language.startsWith("ar") ? "، " : ", ")
                : t("providerLocations.noZones")}
            </span>
            {applicationEditable ? (
              <Link
                to={proPath("/pro/apply") as "/pro/apply"}
                search={{ step: 1 }}
                className="ms-2 inline-flex min-h-11 items-center font-semibold text-brand underline"
              >
                {t("common.edit")}
              </Link>
            ) : rows.length === 1 && secondOptions.length > 0 ? (
              <div className="mt-2 space-y-2 text-start">
                <p className="text-xs font-semibold text-muted-foreground">
                  {t("providerLocations.addSecondZone")}
                </p>
                <select
                  value={pickSecondId ?? ""}
                  onChange={(e) => setPickSecondId(e.target.value || null)}
                  className="h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm font-semibold"
                >
                  <option value="">{t("providerLocations.chooseSecondZone")}</option>
                  {secondOptions.map((z) => (
                    <option key={z.id} value={z.id}>
                      {i18n.language.startsWith("ar") ? z.name_ar : z.name_en}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!pickSecondId || updateZones.isPending}
                  onClick={() => void addSecondZone()}
                  className="focus-ring rounded-xl bg-brand px-3 py-2 text-xs font-bold text-brand-foreground disabled:opacity-50"
                >
                  {updateZones.isPending ? t("common.saving") : t("providerLocations.saveSecondZone")}
                </button>
              </div>
            ) : (
              <Link
                to={proPath("/pro/support") as "/pro/support"}
                search={{ subject: t("pro.support.zoneChangeSubject") }}
                className="ms-2 inline-flex min-h-11 items-center font-semibold text-brand underline"
              >
                {t("providerLocations.requestEdit")}
              </Link>
            )}
          </>
        )}
      </dd>
    </div>
  );
}
