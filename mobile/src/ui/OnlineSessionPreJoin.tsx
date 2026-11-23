import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Text } from "./Text";
import { space } from "./theme";

type Props = {
  onReady: (opts: { audioOnly: boolean }) => void;
  onCancel: () => void;
};

/** Mic/camera permissions are requested by LiveKit when the room connects. */
export function OnlineSessionPreJoin({ onReady, onCancel }: Props) {
  const { t } = useTranslation();

  return (
    <View style={{ gap: space.md, paddingVertical: space.md }}>
      <Text weight="bold">{t("onlineSession.preJoinTitle")}</Text>
      <Text tone="muted">{t("onlineSession.preJoinBody")}</Text>
      <Button
        label={t("onlineSession.joinCustomer")}
        onPress={() => onReady({ audioOnly: false })}
      />
      <Button
        variant="secondary"
        label={t("onlineSession.audioOnlyFallback")}
        onPress={() => onReady({ audioOnly: true })}
      />
      <Button variant="secondary" label={t("common.cancel")} onPress={onCancel} />
    </View>
  );
}