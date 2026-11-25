import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useFavorites } from "@/lib/queries";
import { Page, QueryState } from "@/ui/Page";
import { ProviderCard } from "@/ui/ProviderCard";
import { space } from "@/ui/theme";
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
                label={t("favs.findProviders")}
                onPress={() => router.push("/search")}
                style={{ minHeight: 44, borderRadius: 999 }}
              />
            }
          />
        ) : null}
        {q.data?.map((f) =>
          f.provider ? (
            <View key={f.provider_id} style={{ gap: space.sm }}>
              <ProviderCard provider={f.provider} />
              <Button
                label={t("favs.book")}
                onPress={() =>
                  router.push({
                    pathname: "/book/[providerId]",
                    params: { providerId: f.provider_id },
                  })
                }
                style={{ minHeight: 44, borderRadius: 999 }}
              />
            </View>
          ) : null,
        )}
      </QueryState>
    </Page>
  );
}
