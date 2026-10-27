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
      <View style={{ paddingBottom: 8, paddingEnd: 8, alignSelf: "flex-start" }}>
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
            ...(i18n.language === "ar" ? { left: 0 } : { right: 0 }),
            width: 44,
            height: 44,
            borderRadius: 22,
            borderWidth: 2,
            borderColor: colors.surface,
            backgroundColor: colors.brand,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {busy ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Camera size={20} color={colors.surface} />
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
