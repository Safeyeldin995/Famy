import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { usePlatformContent } from "@/lib/queries";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { View } from "react-native";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { customerStyle } from "@/ui/customer/Primitives";
import { space } from "@/ui/theme";
export default function Content() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { t, i18n } = useTranslation();
  const contentKey = key === "privacy" ? "privacy" : "terms";
  const q = usePlatformContent(contentKey);
  const body = i18n.language === "ar" ? q.data?.body_ar : q.data?.body_en;
  return (
    <Page
      title={t(`profile.${contentKey}`)}
      queries={[q]}
      header={<CustomerPageHeader title={t(`profile.${contentKey}`)} backTo="/profile" />}
      contentStyle={{ paddingTop: 8 }}
    >
      <View style={[customerStyle.card, { padding: space.xl }]}>
        <QueryState query={q} empty={!body} emptyKey="content.empty">
          <Text selectable size="button">
            {body}
          </Text>
        </QueryState>
      </View>
    </Page>
  );
}
