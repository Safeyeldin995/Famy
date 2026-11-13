import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check } from "lucide-react-native";
import { Text } from "./Text";
import { colors, radius, shadow, space } from "./theme";

type ToastContextValue = { show: (message: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast requires ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const insets = useSafeAreaInsets();

  const show = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(msg);
    timer.current = setTimeout(() => setMessage(null), 2400);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {message ? (
        <View
          pointerEvents="none"
          style={[styles.host, { bottom: Math.max(insets.bottom, space.md) + space.lg }]}
          accessibilityLiveRegion="polite"
        >
          <View style={styles.toast}>
            <Check size={18} color={colors.success} accessible={false} />
            <Text weight="bold" style={{ flexShrink: 1 }}>
              {message}
            </Text>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    start: space.xl,
    end: space.xl,
    zIndex: 9999,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 48,
    maxWidth: "100%",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
});
