import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import Svg, { Circle } from "react-native-svg";
import { useTranslation } from "react-i18next";
import {
  Award,
  Baby,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  GraduationCap,
  MapPin,
  MessageSquare,
  Phone,
  User,
} from "lucide-react-native";
import {
  profileCompletionModel,
  type CompletionKey,
  type ProfileCompletionData,
} from "@shared/provider/profileCompletionModel";
import { customerNumber } from "@/lib/customerFormat";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { proCard } from "./cards";

const icons: Record<CompletionKey, typeof User> = {
  photo: User,
  subjects: BookOpen,
  babysitting: Baby,
  hours: Clock,
  about: MessageSquare,
  experience: BriefcaseBusiness,
  education: GraduationCap,
  certificates: Award,
  reference: Phone,
  personal: MapPin,
};

/**
 * «كمل ملفك»: one compact card with a percentage ring. Each row opens its editor,
 * done rows collapse, and the card is gone at 100%.
 */
export function ProfileCompletionCard({
  data,
  only,
}: {
  data: ProfileCompletionData;
  only?: readonly CompletionKey[];
}) {
  const { t, i18n } = useTranslation();
  const [showDone, setShowDone] = useState(false);
  const model = profileCompletionModel(data, only);
  if (model.complete) return null;
  const rtl = i18n.dir() === "rtl";
  const Chevron = rtl ? ChevronLeft : ChevronRight;
  const percentText = customerNumber(model.percent, i18n.language);

  const row = (key: CompletionKey, done: boolean, next: boolean, required: boolean) => {
    const Icon = icons[key];
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={`${t(`profileCompletion.items.${key}.title`)}. ${t(`profileCompletion.items.${key}.reason`)}`}
        onPress={() => router.push({ pathname: "/pro-setup/[item]", params: { item: key } })}
        style={({ pressed }) => ({
          minHeight: 60,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingVertical: space.sm,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: done ? colors.successTint : next ? colors.brandTint : colors.surface2,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {done ? (
            <Check size={18} color={colors.success} />
          ) : (
            <Icon size={20} color={next ? colors.brand : colors.muted} />
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}
          >
            <Text weight="bold" size="sm">
              {t(`profileCompletion.items.${key}.title`)}
            </Text>
            {required && !done ? (
              <View
                style={{
                  paddingHorizontal: space.sm,
                  borderRadius: radius.pill,
                  backgroundColor: colors.warningTint,
                }}
              >
                <Text size="xs" weight="bold" style={{ color: colors.warning }}>
                  {t("profileCompletion.requiredTag")}
                </Text>
              </View>
            ) : null}
          </View>
          {!done ? (
            <Text tone="muted" size="xs">
              {t(`profileCompletion.items.${key}.reason`)}
            </Text>
          ) : null}
        </View>
        <Chevron size={18} color={next ? colors.brand : colors.muted} />
      </Pressable>
    );
  };

  return (
    <View
      style={[proCard.card, { gap: space.md }]}
      accessibilityLabel={t("profileCompletion.ringLabel", { percent: percentText })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
        <View style={{ width: 58, height: 58, alignItems: "center", justifyContent: "center" }}>
          <Svg width={58} height={58} viewBox="0 0 58 58" accessible={false}>
            <Circle cx={29} cy={29} r={24} fill="none" stroke={colors.surface2} strokeWidth={6} />
            <Circle
              cx={29}
              cy={29}
              r={24}
              fill="none"
              stroke={colors.brand}
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray="150.8"
              strokeDashoffset={model.strokeDashoffset}
              transform="rotate(-90 29 29)"
            />
          </Svg>
          <Text weight="heavy" size="sm" style={{ position: "absolute", writingDirection: "ltr" }}>
            {`${percentText}%`}
          </Text>
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text weight="heavy">{t("profileCompletion.title")}</Text>
          <Text tone="muted" size="xs">
            {t(
              model.items.some((i) => i.required)
                ? "profileCompletion.hint"
                : "profileCompletion.hintOptional",
            )}
          </Text>
        </View>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
        {model.todo.map((item) => row(item.key, false, item.next, item.required))}
      </View>
      {model.done.length ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showDone }}
            accessibilityLabel={t(
              showDone ? "profileCompletion.hideDone" : "profileCompletion.doneToggle",
              { count: model.done.length },
            )}
            onPress={() => setShowDone((v) => !v)}
            style={{
              minHeight: 44,
              justifyContent: "center",
              borderRadius: radius.md,
            }}
          >
            <Text size="sm" weight="bold" tone="brand">
              {t(showDone ? "profileCompletion.hideDone" : "profileCompletion.doneToggle", {
                count: customerNumber(model.done.length, i18n.language),
              })}
            </Text>
          </Pressable>
          {showDone ? model.done.map((item) => row(item.key, true, false, item.required)) : null}
        </>
      ) : null}
    </View>
  );
}
