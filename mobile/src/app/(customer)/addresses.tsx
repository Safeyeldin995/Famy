import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Home, Briefcase, Users, MapPin, Pencil, Trash2, Plus, Star } from "lucide-react-native";
import { colors } from "@/ui/theme";
import { customerAreaLabel } from "../../../../src/components/famio/customerAreaLabel";
import { useTranslation } from "react-i18next";
import { useAddresses, useSetDefaultAddress, useDeleteAddress } from "@/lib/queries";
import { Page, QueryState, Confirm, ActionError, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";

export default function Addresses() {
  const { t } = useTranslation();
  const q = useAddresses();
  const setDefault = useSetDefaultAddress();
  const remove = useDeleteAddress();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Page
      title={t("profile.addresses")}
      queries={[q]}
      header={
        <CustomerPageHeader
          title={t("addresses.title")}
          subtitle={t(q.data?.length ? "addresses.subtitle" : "customerRound2.emptyAddressesBody")}
          backTo="/profile"
        />
      }
    >
      <View style={[ui.card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
        <View style={{ flex: 1 }}>
          <Text weight="heavy">
            {t("customerRound2.addressCount", { countLabel: String(q.data?.length ?? 0) })}
          </Text>
          <Text size="xs" tone="muted">
            {t("addresses.subtitle")}
          </Text>
        </View>
        <Button
          style={{ minHeight: 44, borderRadius: 999, paddingHorizontal: 12 }}
          icon={<Plus size={14} color={colors.surface} />}
          label={t("addresses.addAddress")}
          onPress={() => router.push("/addresses/new")}
        />
      </View>
      <ActionError error={setDefault.error || remove.error} />
      {selected && (
        <Confirm
          title={t("mobile.deleteAddress")}
          body={t("mobile.deleteAddressBody")}
          busy={remove.isPending}
          onCancel={() => setSelected(null)}
          onConfirm={() => remove.mutate(selected, { onSuccess: () => setSelected(null) })}
        />
      )}
      <QueryState query={q} empty={!q.data?.length} emptyKey="customerHome.addressHint">
        {q.data?.map((a) => {
          const Icon =
            a.label === "home"
              ? Home
              : a.label === "work"
                ? Briefcase
                : a.label === "family"
                  ? Users
                  : MapPin;
          return (
            <View key={a.id} style={[ui.card, { padding: 0, borderRadius: 28, gap: 0 }]}>
              <View style={{ padding: 16, flexDirection: "row", gap: 12 }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: colors.brandTint,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon size={20} color={colors.brand} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <View
                    style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}
                  >
                    <Text size="lg" weight="heavy">
                      {a.label === "other"
                        ? a.custom_label || t("addresses.label.other")
                        : t(`addresses.label.${a.label}`)}
                    </Text>
                    {a.is_default && (
                      <Text
                        size="xs"
                        tone="brand"
                        weight="bold"
                        style={{
                          backgroundColor: colors.brandTint,
                          borderRadius: 999,
                          paddingHorizontal: 8,
                        }}
                      >
                        {t("addresses.default")}
                      </Text>
                    )}
                  </View>
                  <Text size="xs" tone="muted">
                    {[
                      a.street ?? a.line1,
                      a.building,
                      a.compound,
                      a.area ? customerAreaLabel(a.area, t) : "",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </Text>
                  {(a.lat == null || a.lng == null) && (
                    <Text size="xs" tone="brand">
                      {t("addresses.missingLocation")}
                    </Text>
                  )}
                </View>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  gap: 8,
                  padding: 16,
                  paddingTop: 12,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                {!a.is_default && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("mobile.setDefault")}
                    disabled={setDefault.isPending}
                    onPress={() => setDefault.mutate(a.id)}
                    style={{
                      flex: 1,
                      minHeight: 44,
                      borderRadius: 999,
                      backgroundColor: colors.surface2,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text size="xs" weight="heavy">
                      {t("addresses.makeDefault")}
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: "/addresses/[id]", params: { id: a.id } })}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 999,
                    backgroundColor: colors.surface2,
                    flexDirection: "row",
                    gap: 4,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Pencil size={12} color={colors.foreground} />
                  <Text size="xs" weight="heavy">
                    {t("common.edit")}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={remove.isPending || setDefault.isPending}
                  onPress={() => setSelected(a.id)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 999,
                    backgroundColor: colors.brandTint,
                    flexDirection: "row",
                    gap: 4,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Trash2 size={12} color={colors.brand} />
                  <Text size="xs" weight="heavy" tone="brand">
                    {t("common.delete")}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </QueryState>
    </Page>
  );
}
