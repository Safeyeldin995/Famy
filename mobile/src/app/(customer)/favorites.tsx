import { useTranslation } from "react-i18next";
import { useFavorites } from "@/lib/queries";
import { Page, QueryState } from "@/ui/Page";
import { ProviderCard } from "@/ui/ProviderCard";
export default function Favorites() {
  const { t } = useTranslation();
  const q = useFavorites();
  return (
    <Page title={t("profile.favorites")} queries={[q]}>
      <QueryState query={q} empty={!q.data?.length}>
        {q.data?.map(
          (f) => f.provider && <ProviderCard key={f.provider_id} provider={f.provider} />,
        )}
      </QueryState>
    </Page>
  );
}
