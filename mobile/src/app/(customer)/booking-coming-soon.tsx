import { useTranslation } from "react-i18next";
import { Page } from "@/ui/Page";
import { Text } from "@/ui/Text";
export default function BookingComingSoon() {
  const { t } = useTranslation();
  return (
    <Page title={t("mobile.book")}>
      <Text>{t("mobile.comingSoon")}</Text>
      <Text tone="muted">{t("mobile.bookingPhase2")}</Text>
    </Page>
  );
}
