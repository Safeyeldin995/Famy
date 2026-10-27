import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useFamilyMembers, useDeactivateFamilyMember } from "@/lib/queries";
import { Page, QueryState, Confirm, ActionError, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { Users, Plus, Pencil, Trash2 } from "lucide-react-native";
import { CustomerEmpty, customerStyle } from "@/ui/customer/Primitives";
import { colors } from "@/ui/theme";

export default function FamilyMembers() {
  const { t } = useTranslation();
  const q = useFamilyMembers();
  const remove = useDeactivateFamilyMember();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Page
      title={t("familyMembers.title")}
      queries={[q]}
      footer={
        q.data?.length ? (
          <Button
            label={t("familyMembers.addMember")}
            icon={<Plus size={16} color="white" />}
            onPress={() => router.push("/family-members/new")}
          />
        ) : undefined
      }
      header={
        <CustomerPageHeader
          title={t("familyMembers.title")}
          subtitle={t("familyMembers.privacyNotice")}
          backTo="/profile"
        />
      }
    >
      {selected && (
        <Confirm
          title={t("familyMembers.deactivateTitle")}
          body={t("familyMembers.deactivateBody")}
          busy={remove.isPending}
          onCancel={() => setSelected(null)}
          onConfirm={() => remove.mutate(selected, { onSuccess: () => setSelected(null) })}
        />
      )}
      <ActionError error={remove.error} />
      <QueryState query={q}>
        {!q.data?.length ? (
          <CustomerEmpty
            Icon={Users}
            title={t("customerRound2.emptyFamily")}
            body={t("customerRound2.emptyFamilyBody")}
          >
            <Button
              label={t("familyMembers.addMember")}
              icon={<Plus size={16} color="white" />}
              onPress={() => router.push("/family-members/new")}
            />
          </CustomerEmpty>
        ) : null}
        {q.data?.map((m) => (
          <View
            key={m.id}
            style={[customerStyle.card, { borderRadius: 24, opacity: m.is_active ? 1 : 0.6 }]}
          >
            <View style={[customerStyle.row, { alignItems: "flex-start" }]}>
              <View style={customerStyle.icon}>
                <Text size="xl" weight="heavy" tone="brand">
                  {m.full_name.trim().slice(0, 1)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text size="lg" weight="heavy">
                  {m.full_name}
                </Text>
                <Text size="xs" tone="muted">
                  {m.relationship === "other"
                    ? m.relationship_other || t("familyMembers.relationships.other")
                    : t(`familyMembers.relationships.${m.relationship}`)}
                </Text>
              </View>
            </View>
            {m.is_active ? (
              <View
                style={[
                  customerStyle.row,
                  { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 8 },
                ]}
              >
                <Button
                  variant="secondary"
                  label={t("common.edit")}
                  style={{ flex: 1, minHeight: 44, borderRadius: 999 }}
                  icon={<Pencil size={12} color={colors.foreground} />}
                  onPress={() =>
                    router.push({ pathname: "/family-members/[id]", params: { id: m.id } })
                  }
                />
                <Button
                  variant="ghost"
                  label={t("common.delete")}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 999,
                    backgroundColor: colors.brandTint,
                  }}
                  icon={<Trash2 size={12} color={colors.brand} />}
                  disabled={remove.isPending}
                  onPress={() => setSelected(m.id)}
                />
              </View>
            ) : (
              <Text tone="muted">{t("familyMembers.inactive")}</Text>
            )}
          </View>
        ))}
      </QueryState>
    </Page>
  );
}
