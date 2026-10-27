import { useRef, useState, type ComponentRef } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { ChevronDown, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/ui/Text";
import { colors, fonts } from "@/ui/theme";

/** Native counterpart of the web provider form's searchable bottom-sheet select. */
export function BottomSheetSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const ar = i18n.language.startsWith("ar");
  const direction = {
    direction: "ltr" as const,
    flexDirection: ar ? ("row-reverse" as const) : ("row" as const),
  };
  const visible = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const close = () => setOpen(false);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          setSearch("");
          setOpen(true);
        }}
        style={{ opacity: disabled ? 0.5 : 1 }}
      >
        <Text weight="bold" style={styles.label}>
          {label}
        </Text>
        <View style={[styles.input, direction]}>
          <Text style={{ flexShrink: 1 }}>
            {options.find((option) => option.value === value)?.label ?? t("providerApply.select")}
          </Text>
          <ChevronDown size={18} color={colors.foreground} />
        </View>
      </Pressable>
      <Modal visible={open && !disabled} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.modal}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={t("providerApply.close")}
          />
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}
          >
            <View style={styles.grab} />
            <View style={[styles.heading, direction]}>
              <Text weight="heavy" size="lg">
                {label}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("providerApply.close")}
                onPress={close}
                style={styles.close}
              >
                <X size={18} color={colors.foreground} />
              </Pressable>
            </View>
            {options.length > 7 && (
              <TextInput
                accessibilityLabel={t("common.search")}
                placeholder={t("common.search")}
                value={search}
                onChangeText={setSearch}
                style={[
                  styles.input,
                  {
                    fontFamily: (ar ? fonts.ar : fonts.en).regular,
                    textAlign: ar ? "right" : "left",
                  },
                ]}
              />
            )}
            <ScrollView
              ref={scroll}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: "70%" }}
            >
              {visible.length === 0 && <Text>{t("providerApply.noOptions")}</Text>}
              {visible.map((option) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: option.value === value }}
                  style={[styles.option, direction]}
                  onLayout={(event) => {
                    if (!search && option.value === value)
                      scroll.current?.scrollTo({
                        y: Math.max(0, event.nativeEvent.layout.y - 100),
                        animated: false,
                      });
                  }}
                  onPress={() => {
                    if (!disabled) onChange(option.value);
                    close();
                  }}
                >
                  <Text weight={option.value === value ? "heavy" : "regular"}>{option.label}</Text>
                  <View style={[styles.radio, option.value === value && styles.selected]} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: "#4d4550", marginBottom: 8 },
  input: {
    height: 56,
    borderRadius: 16,
    backgroundColor: "#f6f4f5",
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: 16,
    color: colors.foreground,
  },
  modal: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,13,16,.42)" },
  sheet: {
    maxHeight: "80%",
    backgroundColor: "white",
    borderTopStartRadius: 28,
    borderTopEndRadius: 28,
    padding: 20,
    gap: 12,
  },
  grab: { height: 4, width: 40, borderRadius: 2, backgroundColor: "#ece8ea", alignSelf: "center" },
  heading: { alignItems: "center", justifyContent: "space-between" },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f6f4f5",
  },
  option: {
    minHeight: 52,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "space-between",
  },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: "#ece8ea" },
  selected: { borderWidth: 6, borderColor: colors.brand },
});
