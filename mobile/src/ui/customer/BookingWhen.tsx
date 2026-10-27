import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react-native";
import { useAvailableSlots } from "@/lib/bookingQueries";
import { filterFixedStartSlots, type PackageService } from "@shared/pricing/servicePackages";
import { bookingTimeLabel, bookingWhenValues } from "@shared/booking/bookingLabels";
import { Text } from "../Text";
import { colors } from "../theme";
import { QueryState } from "../Page";
type Slot = { start: Date; end: Date; label: string };
type Props = {
  providerId: string;
  serviceId: string;
  addressId: string;
  service: PackageService;
  durationMinutes: number;
  maxAdvanceDays: number;
  cairoTime: boolean;
  locale: string;
  date: Date;
  selected: Slot | null;
  slots: Slot[];
  loading: boolean;
  error: boolean;
  onRetry: () => unknown;
  onDateChange: (date: Date) => void;
  onTimeChange: (slot: Slot) => void;
};
function Day({ day, index, ...props }: Props & { day: Date; index: number }) {
  const slots = useAvailableSlots(props.providerId, day, props.durationMinutes, {
    serviceId: props.serviceId,
    addressId: props.addressId,
    cairoTime: props.cairoTime,
    fixedStartTime: props.service.fixed_start_time,
  });
  const disabled =
    index >= props.maxAdvanceDays ||
    (slots.isSuccess &&
      !slots.isFetching &&
      !filterFixedStartSlots(slots.data ?? [], props.service).length);
  const selected = props.date.toDateString() === day.toDateString();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={day.toLocaleDateString(props.locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={() => props.onDateChange(day)}
      style={{
        width: 58,
        height: 72,
        borderRadius: 16,
        backgroundColor: selected ? colors.brand : colors.surface2,
        justifyContent: "center",
        alignItems: "center",
        gap: 2,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text size="xs" weight="bold" tone={selected ? "inverse" : "muted"}>
        {day.toLocaleDateString(props.locale, { weekday: "short" })}
      </Text>
      <Text size="xxl" weight="heavy" tone={selected ? "inverse" : "default"}>
        {day.toLocaleDateString(props.locale, { day: "numeric" })}
      </Text>
    </Pressable>
  );
}
export function CustomerBookingWhen(props: Props) {
  const { t } = useTranslation();
  const days = useMemo(
    () =>
      Array.from({ length: 14 }, (_, index) => {
        const day = new Date();
        day.setHours(0, 0, 0, 0);
        day.setDate(day.getDate() + index);
        return day;
      }),
    [],
  );
  const candidates = useAvailableSlots(props.providerId, props.date, props.durationMinutes, {
    serviceId: props.serviceId,
    addressId: props.addressId,
    cairoTime: props.cairoTime,
    fixedStartTime: props.service.fixed_start_time,
    includeUnavailable: true,
  });
  const display = candidates.isSuccess
    ? filterFixedStartSlots(candidates.data ?? [], props.service)
    : props.slots;
  return (
    <View style={{ gap: 12 }}>
      <Text size="sm" weight="bold">
        {props.date.toLocaleDateString(props.locale, { month: "long" })}
      </Text>
      <ScrollView
        horizontal
        style={{ flexGrow: 0, height: 76 }}
        contentContainerStyle={{ gap: 8 }}
        accessibilityLabel={t("bookFlow.datesLabel")}
      >
        {days.map((day, index) => (
          <Day key={day.toDateString()} {...props} day={day} index={index} />
        ))}
      </ScrollView>
      <Text size="sm" weight="bold">
        {t("bookFlow.timesLabel")}
      </Text>
      <QueryState
        query={{ isLoading: props.loading, isError: props.error, refetch: props.onRetry }}
      >
        {!props.slots.length && <Text tone="muted">{t("customerRound2.noSlots")}</Text>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {display.map((slot) => {
            const available = props.slots.find((s) => +s.start === +slot.start);
            const selected = props.selected != null && +props.selected.start === +slot.start;
            return (
              <Pressable
                key={slot.start.toISOString()}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: !available }}
                disabled={!available}
                onPress={() => available && props.onTimeChange(available)}
                style={{
                  width: "31.5%",
                  height: 44,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: selected ? colors.brandTint : colors.surface2,
                  borderWidth: selected ? 1.5 : 0,
                  borderColor: colors.brand,
                }}
              >
                <Text
                  weight="bold"
                  style={{
                    color: selected ? colors.brand : available ? colors.foreground : colors.muted,
                    textDecorationLine: available ? "none" : "line-through",
                  }}
                >
                  {bookingTimeLabel(slot.start, props.locale, props.cairoTime)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </QueryState>
      {props.selected && (
        <View
          style={{
            flexDirection: "row",
            gap: 10,
            alignItems: "center",
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: 14,
            backgroundColor: colors.brandTint,
          }}
        >
          <Clock size={18} color={colors.brand} />
          <Text weight="bold" tone="brand" style={{ flex: 1 }}>
            {t(
              "customerBooking.whenSummary",
              bookingWhenValues(props.date, props.selected, props.locale, props.cairoTime),
            )}
          </Text>
        </View>
      )}
    </View>
  );
}
