import { useState } from "react";
import { Pressable, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import type { PickedFile } from "@/lib/provider/documentUpload";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { FileText, IdCard } from "lucide-react-native";
import { proCard } from "./cards";

export function DocumentUploadCard({
  title,
  statusLabel,
  rejectedReason,
  captured,
  disabled,
  onPick,
  compact = false,
}: {
  title: string;
  statusLabel: string;
  rejectedReason?: string | null;
  captured: boolean;
  disabled?: boolean;
  onPick: (file: PickedFile) => Promise<void>;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (pdf: boolean) => {
    if (disabled || busy) return;
    setError("");
    setBusy(true);
    try {
      let asset: PickedFile | null = null;
      if (pdf) {
        const result = await DocumentPicker.getDocumentAsync({
          type: ["application/pdf", "image/jpeg", "image/png"],
          copyToCacheDirectory: true,
        });
        if (!result.canceled && result.assets[0]) {
          const a = result.assets[0];
          asset = {
            uri: a.uri,
            mimeType: a.mimeType,
            fileName: a.name,
            fileSize: a.size,
          };
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) throw new Error("denied");
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.85,
        });
        if (!result.canceled && result.assets[0]) {
          const a = result.assets[0];
          asset = {
            uri: a.uri,
            mimeType: a.mimeType ?? "image/jpeg",
            fileName: a.fileName,
            fileSize: a.fileSize,
          };
        }
      }
      if (asset) await onPick(asset);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "file_too_large") setError(t("mobilePro.fileTooLarge"));
      else if (msg === "invalid_file_type") setError(t("mobilePro.invalidFileType"));
      else setError(t("common.somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  };

  if (compact) {
    const approved = statusLabel === t("providerDocuments.approved");
    const pending = statusLabel === t("providerDocuments.pending");
    return (
      <View style={{ gap: space.sm }}>
        <View
          style={{
            minHeight: 76,
            borderRadius: radius.lg,
            padding: space.md,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: approved || pending ? "#E7F7EF" : colors.surface,
          }}
        >
          <View
            style={{
              width: 52,
              height: 48,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.surface2,
            }}
          >
            {title.includes(t("providerDocuments.certificate")) ? (
              <FileText size={22} color={colors.muted} />
            ) : (
              <IdCard size={24} color={colors.muted} />
            )}
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text weight="bold" size="sm">
              {title}
            </Text>
            <Text size="xs" tone={approved ? "success" : pending ? "muted" : "danger"}>
              {statusLabel}
            </Text>
          </View>
          {!disabled ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(
                captured ? "providerDocuments.replace" : "providerDocuments.upload",
              )}
              onPress={() => void pick(true)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text tone="brand" weight="bold" size="xs">
                {t(captured ? "providerDocuments.replace" : "providerDocuments.upload")}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {rejectedReason ? (
          <Text tone="danger" size="sm">
            {rejectedReason}
          </Text>
        ) : null}
        {error ? (
          <Text tone="danger" size="sm">
            {error}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <View style={proCard.card}>
      <Text weight="heavy">{title}</Text>
      <Text tone="muted" size="sm">
        {statusLabel}
      </Text>
      {rejectedReason ? (
        <Text tone="danger" size="sm">
          {rejectedReason}
        </Text>
      ) : null}
      {error ? (
        <Text tone="danger" size="sm">
          {error}
        </Text>
      ) : null}
      <Button
        variant="secondary"
        loading={busy}
        disabled={disabled}
        label={t(captured ? "providerDocuments.replace" : "providerDocuments.upload")}
        onPress={() => void pick(false)}
      />
      <Button
        variant="ghost"
        loading={busy}
        disabled={disabled}
        label={t("providerDocuments.uploadIdFile")}
        onPress={() => void pick(true)}
      />
    </View>
  );
}
