import { useState } from "react";
import { Linking, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSupportContact } from "@/lib/queries";
import { Page, QueryState, ActionError, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
export default function Help() {
  const { t } = useTranslation();
  const q = useSupportContact();
  const [error, setError] = useState(false);
  const open = async (url: string) => {
    try {
      await Linking.openURL(url);
      setError(false);
    } catch {
      setError(true);
    }
  };
  const phone = q.data?.phone?.replace(/[^\d+]/g, "");
  const whatsapp = q.data?.whatsapp?.replace(/\D/g, "");
  const faqs = t("helpC.faqs", { returnObjects: true }) as { q: string; a: string }[];
  return (
    <Page title={t("helpC.title")} queries={[q]}>
      <QueryState query={q} empty={!phone && !whatsapp} emptyKey="mobile.supportUnavailable">
        {whatsapp && (
          <Button label={t("helpC.whatsapp")} onPress={() => open(`https://wa.me/${whatsapp}`)} />
        )}
        {phone && (
          <Button
            variant="secondary"
            label={t("helpC.call")}
            onPress={() => open(`tel:${phone}`)}
          />
        )}
      </QueryState>
      <ActionError error={error} />
      <Text size="xl" weight="heavy">
        {t("helpC.faqsTitle")}
      </Text>
      {faqs.map((f, i) => (
        <View key={i} style={ui.card}>
          <Text weight="heavy">{f.q}</Text>
          <Text>{f.a}</Text>
        </View>
      ))}
    </Page>
  );
}
