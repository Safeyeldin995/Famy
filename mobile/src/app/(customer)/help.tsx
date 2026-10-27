import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { MessageCircle, Phone, MessageSquare, ChevronDown } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSupportContact } from "@/lib/queries";
import { Page, QueryState, ActionError, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { colors } from "@/ui/theme";
export default function Help() {
  const { t } = useTranslation();
  const q = useSupportContact();
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(0);
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
    <Page
      title={t("helpC.title")}
      queries={[q]}
      header={
        <CustomerPageHeader
          hero
          title={t("helpC.title")}
          subtitle={t("helpC.heroBody")}
          backTo="/profile"
        />
      }
      contentStyle={{ paddingTop: 0, gap: 16 }}
      scrollHeader
    >
      <View style={[ui.card, { marginTop: -32, borderRadius: 28, padding: 20 }]}>
        <Text size="xl" weight="heavy">
          {t("helpC.heroTitle")}
        </Text>
        <QueryState query={q} empty={!phone && !whatsapp} emptyKey="mobile.supportUnavailable">
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[
              {
                key: "chat",
                Icon: MessageCircle,
                url: whatsapp ? `https://wa.me/${whatsapp}` : null,
              },
              { key: "call", Icon: Phone, url: phone ? `tel:${phone}` : null },
              {
                key: "whatsapp",
                Icon: MessageSquare,
                url: whatsapp ? `https://wa.me/${whatsapp}` : null,
              },
            ].map(({ key, Icon, url }) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                disabled={!url}
                onPress={() => url && void open(url)}
                style={{
                  flex: 1,
                  borderRadius: 20,
                  padding: 12,
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: colors.surface2,
                  opacity: url ? 1 : 0.5,
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.brand,
                  }}
                >
                  <Icon size={20} color="white" />
                </View>
                <Text size="xs" weight="heavy">
                  {t(`helpC.${key}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        </QueryState>
      </View>
      <ActionError error={error} />
      <Text size="xs" weight="bold" style={{ marginTop: 8 }}>
        {t("helpC.faqsTitle")}
      </Text>
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 28,
          backgroundColor: colors.surface,
          overflow: "hidden",
        }}
      >
        {faqs.map((f, i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityState={{ expanded: expanded === i }}
            onPress={() => setExpanded(expanded === i ? null : i)}
            style={{
              padding: 16,
              borderBottomWidth: i === faqs.length - 1 ? 0 : 1,
              borderColor: colors.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Text weight="heavy" style={{ flex: 1 }}>
                {f.q}
              </Text>
              <ChevronDown
                size={16}
                color={colors.muted}
                style={{ transform: [{ rotate: expanded === i ? "180deg" : "0deg" }] }}
              />
            </View>
            {expanded === i && (
              <Text size="xs" tone="muted" style={{ marginTop: 8, lineHeight: 20 }}>
                {f.a}
              </Text>
            )}
          </Pressable>
        ))}
      </View>
      <Button
        variant="secondary"
        label={t("helpC.reportIssue")}
        disabled={!whatsapp || q.isError || q.isLoading}
        onPress={() =>
          void open(
            `https://wa.me/${whatsapp}?text=${encodeURIComponent(t("helpC.urgentPrefill"))}`,
          )
        }
      />
    </Page>
  );
}
