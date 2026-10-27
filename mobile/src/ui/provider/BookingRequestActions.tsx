import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useProviderUpdateBookingStatus } from "@/lib/provider/queries";
import { Button } from "@/ui/Button";
import { ActionError } from "@/ui/Page";
import { colors } from "@/ui/theme";
import { DeclineSheet } from "./DeclineSheet";

export function BookingRequestActions({ id }: { id: string }) {
  const { t } = useTranslation();
  const update = useProviderUpdateBookingStatus();
  const [declining, setDeclining] = useState(false);

  return (
    <>
      <View style={{ flexDirection: "row", gap: 8, paddingTop: 8 }}>
        <Button
          label={t("proWork.accept")}
          loading={update.isPending}
          onPress={() => update.mutate({ id, status: "confirmed" })}
          style={{ flex: 1, minHeight: 44, borderRadius: 999 }}
        />
        <Button
          variant="secondary"
          label={t("proRound2.decline")}
          disabled={update.isPending}
          onPress={() => setDeclining(true)}
          style={{ flex: 1, minHeight: 44, borderRadius: 999, borderColor: colors.brand }}
        />
      </View>
      <ActionError error={update.error} />
      <DeclineSheet
        bookingId={id}
        visible={declining}
        onClose={() => setDeclining(false)}
        title={t("pro.booking.declineConfirm")}
      />
    </>
  );
}
