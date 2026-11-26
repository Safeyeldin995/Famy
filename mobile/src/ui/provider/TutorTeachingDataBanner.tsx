// «كمل المواد والمناهج والسنين اللي بتدرسها عشان الطلبة يلاقوك» (issue 536 PR 2).
// A tutor whose approved tutoring service has no approved subject / system / grade is hidden
// from students by strict matching, so we point them to the subjects setup.
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { GraduationCap } from "lucide-react-native";
import { useMyProvider } from "@/lib/provider/queries";
import { useTutorMissingTeachingData } from "@/lib/studentMatchQueries";
import { Text } from "../Text";
import { Button } from "../Button";
import { colors, radius, space } from "../theme";

export function TutorTeachingDataBanner() {
  const { t } = useTranslation();
  const providerQ = useMyProvider();
  const providerId = (providerQ.data as { id?: string } | null | undefined)?.id;
  const missing = useTutorMissingTeachingData(providerId);
  if (!missing.data) return null;
  return (
    <View
      accessibilityRole="summary"
      style={{
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.brand,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <GraduationCap size={22} color={colors.brand} />
        <Text weight="bold" style={{ flex: 1 }}>
          {t("studentMatch.tutorBanner.title")}
        </Text>
      </View>
      <Button
        label={t("studentMatch.tutorBanner.action")}
        onPress={() => router.push({ pathname: "/pro-setup/[item]", params: { item: "subjects" } })}
      />
    </View>
  );
}
