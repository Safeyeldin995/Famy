import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { BadgeCheck, BriefcaseBusiness, GraduationCap } from "lucide-react-native";
import { yearRange } from "@shared/provider/credentials";
import { usePublicCredentials } from "@/lib/provider/credentialQueries";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      <Text size="lg" weight="heavy">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Public tutor profile: education, experience and admin-verified certificates. Hidden when empty. */
export function ProviderCredentialsSection({ providerId }: { providerId: string | undefined }) {
  const { t } = useTranslation();
  const q = usePublicCredentials(providerId);
  const d = q.data;
  if (!d || (!d.education.length && !d.experience.length && !d.certificates.length)) return null;
  const present = t("providerCredentials.present");
  return (
    <>
      {d.certificates.length ? (
        <Block title={t("providerCredentials.profile.certificates")}>
          {d.certificates.map((c) => (
            <View
              key={c.id}
              style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}
            >
              <BadgeCheck size={20} color={colors.success} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="bold">{c.title}</Text>
                <Text size="sm" tone="muted">
                  {c.issuer}
                  {c.issued_year ? ` · ${c.issued_year}` : ""}
                </Text>
                <Text size="xs" weight="bold" tone="success">
                  {t("providerCredentials.certificates.verifiedBadge")}
                </Text>
              </View>
            </View>
          ))}
        </Block>
      ) : null}
      {d.education.length ? (
        <Block title={t("providerCredentials.profile.education")}>
          {d.education.map((e) => {
            const years = yearRange(e.start_year, e.end_year, false, present);
            return (
              <View
                key={e.id}
                style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}
              >
                <GraduationCap size={20} color={colors.brand} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="bold">
                    {e.degree}
                    {e.field_of_study ? ` · ${e.field_of_study}` : ""}
                  </Text>
                  <Text size="sm" tone="muted">
                    {e.institution}
                    {years ? ` · ${years}` : ""}
                  </Text>
                </View>
              </View>
            );
          })}
        </Block>
      ) : null}
      {d.experience.length ? (
        <Block title={t("providerCredentials.profile.experience")}>
          {d.experience.map((w) => {
            const years = yearRange(w.start_year, w.end_year, w.is_current, present);
            return (
              <View
                key={w.id}
                style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}
              >
                <BriefcaseBusiness size={20} color={colors.brand} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="bold">{w.role_title}</Text>
                  <Text size="sm" tone="muted">
                    {w.place}
                    {years ? ` · ${years}` : ""}
                  </Text>
                  {w.description ? <Text size="sm">{w.description}</Text> : null}
                </View>
              </View>
            );
          })}
        </Block>
      ) : null}
    </>
  );
}
