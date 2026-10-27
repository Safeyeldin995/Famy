import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { MapPin, LocateFixed, Pencil, Check, ArrowRight, ArrowLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { isValidLatLng } from "@shared/geo/latLng";
import { Text } from "../Text";
import { Button } from "../Button";
import { colors } from "../theme";
import MapSurface from "./MapSurface";
import { parseMapMessage, type MapPosition } from "./mapMessages";

const fallback = { lat: 29.9765, lng: 30.9317 };
function Pin() {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: "50%",
        start: "50%",
        width: 44,
        height: 44,
        marginStart: -22,
        marginTop: -44,
        backgroundColor: colors.brand,
        borderColor: "white",
        borderWidth: 4,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <MapPin size={20} color="white" />
    </View>
  );
}

export function LocationPicker({
  value,
  onChange,
}: {
  value: MapPosition | null;
  onChange: (p: MapPosition) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MapPosition | null>(null);
  const [center, setCenter] = useState(fallback);
  const [key, setKey] = useState(0);
  const [failed, setFailed] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState("");
  const valid = isValidLatLng(value);
  const Back = i18n.language === "ar" ? ArrowRight : ArrowLeft;
  function show(position: MapPosition | null) {
    setCenter(position ?? fallback);
    setDraft(position);
    setFailed(false);
    setNotice("");
    setKey((k) => k + 1);
    setOpen(true);
  }
  async function locate() {
    setLocating(true);
    setNotice("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setNotice(t("addresses.geoDenied"));
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const next = { lat: position.coords.latitude, lng: position.coords.longitude };
      if (!isValidLatLng(next)) throw new Error("invalid_coordinates");
      show(next);
    } catch {
      setNotice(t("addresses.geoFailed"));
    } finally {
      setLocating(false);
    }
  }
  const unavailable = (retry: () => void) => (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
      <Text size="xs" weight="bold">
        {t("addresses.mapUnavailable")}
      </Text>
      <Button label={t("common.retry")} onPress={retry} />
    </View>
  );
  return (
    <>
      {valid && value ? (
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: "hidden",
          }}
        >
          <View style={{ height: 144 }}>
            {previewFailed ? (
              unavailable(() => {
                setPreviewFailed(false);
                setKey((k) => k + 1);
              })
            ) : (
              <MapSurface
                key={key}
                center={value}
                interactive={false}
                onMessage={(raw) => {
                  if (parseMapMessage(raw) === "unavailable") setPreviewFailed(true);
                }}
              />
            )}
            <Pin />
          </View>
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Check size={20} color={colors.success} />
            <Text weight="bold" style={{ flex: 1 }}>
              {t("locationPicker.saved")}
            </Text>
            <Button
              variant="ghost"
              icon={<Pencil size={16} color={colors.brand} />}
              label={t("locationPicker.change")}
              onPress={() => show(value)}
            />
          </View>
        </View>
      ) : (
        <View
          style={{
            padding: 16,
            borderWidth: 2,
            borderStyle: "dashed",
            borderColor: colors.brandTintStrong,
            borderRadius: 16,
            backgroundColor: "#F10E7208",
            gap: 16,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <MapPin size={24} color={colors.brand} />
            <View style={{ flex: 1 }}>
              <Text weight="heavy">{t("locationPicker.emptyTitle")}</Text>
              <Text size="xs" tone="muted">
                {t("locationPicker.emptyBody")}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              style={{ flex: 1 }}
              label={t("locationPicker.useMyLocation")}
              loading={locating}
              onPress={() => void locate()}
            />
            <Button
              style={{ flex: 1 }}
              variant="secondary"
              label={t("locationPicker.pickOnMap")}
              onPress={() => show(null)}
            />
          </View>
        </View>
      )}
      {!open && notice ? (
        <Text tone="danger" size="xs">
          {notice}
        </Text>
      ) : null}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: colors.surface2,
            direction: i18n.language === "ar" ? "rtl" : "ltr",
          }}
        >
          <View style={{ position: "absolute", inset: 0 }}>
            {failed ? (
              unavailable(() => {
                setFailed(false);
                setKey((k) => k + 1);
              })
            ) : (
              <MapSurface
                key={key}
                center={center}
                interactive
                onMessage={(raw) => {
                  const message = parseMapMessage(raw);
                  if (message === "unavailable") setFailed(true);
                  else if (message) setDraft(message);
                }}
              />
            )}
            <Pin />
          </View>
          <View style={{ flexDirection: "row", gap: 12, padding: 16, alignItems: "center" }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.back")}
              onPress={() => setOpen(false)}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: "white",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Back size={20} color={colors.foreground} />
            </Pressable>
            <Text
              weight="heavy"
              style={{ backgroundColor: "white", borderRadius: 24, padding: 12 }}
            >
              {t("locationPicker.sheetTitle")}
            </Text>
          </View>
          <View style={{ marginTop: "auto", padding: 16, gap: 12 }}>
            <Button
              variant="secondary"
              style={{ alignSelf: "flex-end" }}
              label={t("locationPicker.myLocationShort")}
              icon={<LocateFixed size={16} color={colors.brand} />}
              loading={locating}
              onPress={() => void locate()}
            />
            <View style={{ padding: 16, borderRadius: 24, backgroundColor: "white", gap: 8 }}>
              <Text weight="heavy">{t("locationPicker.sheetHintTitle")}</Text>
              <Text size="xs" tone="muted">
                {t("locationPicker.sheetHintBody")}
              </Text>
              {notice ? (
                <Text size="xs" tone="danger">
                  {notice}
                </Text>
              ) : null}
              <Button
                label={t("locationPicker.confirm")}
                disabled={!draft}
                onPress={() => {
                  if (draft) {
                    onChange(draft);
                    setOpen(false);
                  }
                }}
              />
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}
