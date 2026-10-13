import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { QueryError } from "@/components/famio/QueryError";
import { proPath } from "@/lib/preview/previewPath";

export function ProfileWorkZones({
  providerId,
  applicationEditable,
}: {
  providerId: string;
  applicationEditable: boolean;
}) {
  const { t, i18n } = useTranslation();
  const query = useQuery({
    queryKey: ["provider-work-zone-names", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zone_providers")
        .select("zone_id, zone:zones(name_ar, name_en)")
        .eq("provider_id", providerId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const names = (query.data ?? [])
    .map(({ zone }) => (i18n.language.startsWith("ar") ? zone?.name_ar : zone?.name_en))
    .filter(Boolean);
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
            <Link
              to={proPath(applicationEditable ? "/pro/apply" : "/pro/support") as "/pro/apply"}
              search={applicationEditable ? { step: 1 } : undefined}
              className="ms-2 inline-flex min-h-11 items-center font-semibold text-brand underline"
            >
              {t(applicationEditable ? "common.edit" : "providerLocations.requestEdit")}
            </Link>
          </>
        )}
      </dd>
    </div>
  );
}
