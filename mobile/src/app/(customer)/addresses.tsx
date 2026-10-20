import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAddresses, useSetDefaultAddress, useDeleteAddress } from "@/lib/queries";
import { Page, QueryState, Confirm, ActionError, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";

export default function Addresses() {
  const { t } = useTranslation();
  const q = useAddresses();
  const setDefault = useSetDefaultAddress();
  const remove = useDeleteAddress();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Page title={t("profile.addresses")} queries={[q]}>
      <Text tone="muted">{t("mobile.addressPhase2")}</Text>
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
        {q.data?.map((a) => (
          <View key={a.id} style={ui.card}>
            <Text size="lg" weight="heavy">
              {a.area || t(`addresses.labels.${a.label}`, { defaultValue: t("profile.addresses") })}
            </Text>
            <Text>{[a.street, a.building, a.floor, a.apartment].filter(Boolean).join(" · ")}</Text>
            {a.is_default ? (
              <Text tone="brand" weight="bold">
                {t("mobile.defaultAddress")}
              </Text>
            ) : (
              <Button
                variant="secondary"
                label={t("mobile.setDefault")}
                loading={setDefault.isPending}
                onPress={() => setDefault.mutate(a.id)}
              />
            )}
            <Button
              variant="ghost"
              label={t("common.delete")}
              disabled={remove.isPending || setDefault.isPending}
              onPress={() => setSelected(a.id)}
            />
          </View>
        ))}
      </QueryState>
    </Page>
  );
}
