import { useRef, useState, type ComponentRef } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { ChevronDown, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/ui/Text";
import { bodyTextInputProps } from "@/ui/a11y";
import { colors, fontSize, fonts, radius, space } from "@/ui/theme";

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
        <Text size="sm" weight="bold" tone="muted" style={styles.label}>
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
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.xl) }]}
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
                  styles.searchInput,
                  {
                    fontFamily: (ar ? fonts.ar : fonts.en).regular,
                    textAlign: ar ? "right" : "left",
                  },
                ]}
                {...bodyTextInputProps()}
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
  label: { marginBottom: space.sm },
  input: {
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    fontSize: fontSize.lg,
    color: colors.foreground,
    justifyContent: "center",
  },
  modal: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,13,16,.42)" },
  sheet: {
    maxHeight: "80%",
    backgroundColor: colors.surface,
    borderTopStartRadius: radius.xl + 4,
    borderTopEndRadius: radius.xl + 4,
    padding: space.xl,
    gap: space.md,
  },
  grab: {
    height: 4,
    width: 40,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
  },
  heading: { alignItems: "center", justifyContent: "space-between" },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  option: {
    minHeight: 52,
    paddingVertical: space.md,
    alignItems: "center",
    justifyContent: "space-between",
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selected: { borderWidth: 6, borderColor: colors.brand },
});
