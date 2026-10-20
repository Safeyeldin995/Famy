import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useFamilyMembers, useDeactivateFamilyMember } from "@/lib/queries";
import { Page, QueryState, Confirm, ActionError, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";

export default function FamilyMembers() {
  const { t } = useTranslation();
  const q = useFamilyMembers();
  const remove = useDeactivateFamilyMember();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Page title={t("familyMembers.title")} queries={[q]}>
      <Button
        label={t("familyMembers.addMember")}
        onPress={() => router.push("/family-members/new")}
      />
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
      <QueryState query={q} empty={!q.data?.length} emptyKey="familyMembers.empty">
        {q.data?.map((m) => (
          <View key={m.id} style={ui.card}>
            <Text size="lg" weight="heavy">
              {m.full_name}
            </Text>
            <Text>{t(`familyMembers.relationships.${m.relationship}`)}</Text>
            {m.is_active ? (
              <>
                <Button
                  variant="secondary"
                  label={t("common.edit")}
                  onPress={() =>
                    router.push({ pathname: "/family-members/[id]", params: { id: m.id } })
                  }
                />
                <Button
                  variant="ghost"
                  label={t("common.delete")}
                  disabled={remove.isPending}
                  onPress={() => setSelected(m.id)}
                />
              </>
            ) : (
              <Text tone="muted">{t("familyMembers.inactive")}</Text>
            )}
          </View>
        ))}
      </QueryState>
    </Page>
  );
}
