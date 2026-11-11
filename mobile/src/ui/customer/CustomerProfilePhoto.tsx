import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Camera } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { uploadAvatar } from "@/lib/provider/documentUpload";
import { Avatar } from "../ProviderCard";
import { Text } from "../Text";
import { colors } from "../theme";

export function CustomerProfilePhoto({ src, name }: { src?: string | null; name: string }) {
  const { t, i18n } = useTranslation();
  const { session } = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ar = i18n.language.startsWith("ar");
  async function pick() {
    if (!session?.user.id || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]) return;
      await uploadAvatar(session.user.id, result.assets[0]);
      await qc.invalidateQueries({ queryKey: ["my-profile"] });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 4 }}>
      <View
        testID="customer-profile-photo"
        style={{
          paddingBottom: 8,
          ...(ar ? { paddingStart: 10 } : { paddingEnd: 10 }),
          alignSelf: "flex-start",
          direction: "ltr",
        }}
      >
        <Avatar raw={src} name={name} size={80} round />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("setup.photoHint")}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void pick()}
          style={{
            position: "absolute",
            bottom: 0,
            ...(ar ? { start: 0 } : { end: 0 }),
            width: 36,
            height: 36,
            borderRadius: 18,
            borderWidth: 2,
            borderColor: colors.surface,
            backgroundColor: colors.brand,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {busy ? (
            <ActivityIndicator color={colors.surface} size="small" />
          ) : (
            <Camera size={16} color={colors.surface} />
          )}
        </Pressable>
      </View>
      {failed ? (
        <Text size="xs" tone="danger" accessibilityRole="alert">
          {t("setup.uploadFailed")}
        </Text>
      ) : null}
    </View>
  );
}
