import { useTranslation } from "react-i18next";
import { Page } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { TutorDemandCard } from "@/ui/provider/TutorDemandCard";
import { space } from "@/ui/theme";

export default function ProDemandScreen() {
  const { t } = useTranslation();
  return (
    <Page title={t("tutorDemand.title")} contentStyle={{ gap: space.md }}>
      <Text tone="muted">{t("tutorDemand.subtitle")}</Text>
      <TutorDemandCard showTitle={false} />
    </Page>
  );
}
