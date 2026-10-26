import { useTranslation } from "react-i18next";
import { useFavorites } from "@/lib/queries";
import { Page, QueryState } from "@/ui/Page";
import { ProviderCard } from "@/ui/ProviderCard";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { CustomerEmptyState } from "@/ui/CustomerEmptyState";
import { Button } from "@/ui/Button";
import { Heart } from "lucide-react-native";
import { router } from "expo-router";
export default function Favorites() {
  const { t } = useTranslation();
  const q = useFavorites();
  return (
    <Page
      title={t("profile.favorites")}
      queries={[q]}
      header={
        <CustomerPageHeader
          hero
          title={t("favs.title")}
          subtitle={t("favs.emptyBody")}
          backTo="/profile"
        />
      }
    >
      <QueryState query={q}>
        {!q.data?.length ? (
          <CustomerEmptyState
            icon={Heart}
            title={t("favs.emptyTitle")}
            body={t("favs.emptyBody")}
            action={
              <Button
                label={t("favs.browse")}
                onPress={() => router.push("/home")}
                style={{ minHeight: 44, borderRadius: 999 }}
              />
            }
          />
        ) : null}
        {q.data?.map(
          (f) => f.provider && <ProviderCard key={f.provider_id} provider={f.provider} />,
        )}
      </QueryState>
    </Page>
  );
}
