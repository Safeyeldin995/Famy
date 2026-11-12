import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { BookingJourneyStepper } from "@/ui/BookingJourneyStepper";
import { useBookingStatusHistory } from "@/lib/bookingJourneyQueries";
import type { BookingJourneySnapshot } from "@shared/booking/journeyTimestamps";

export function BookingStatusCard({
  bookingId,
  status,
  booking,
}: {
  bookingId: string;
  status: string;
  booking: BookingJourneySnapshot;
}) {
  const { t } = useTranslation();
  const historyQ = useBookingStatusHistory(bookingId);
  const history = historyQ.data ?? [];

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.xl,
        backgroundColor: colors.surface,
        padding: space.lg,
        gap: space.md,
      }}
    >
      <Text
        weight="bold"
        size="xs"
        tone={status === "completed" ? "success" : status === "pending" ? "muted" : "brand"}
        style={{
          alignSelf: "flex-start",
          backgroundColor: status === "pending" ? "#FFF5DF" : colors.brandTint,
          borderRadius: radius.pill,
          paddingHorizontal: space.sm,
          paddingVertical: space.xs,
        }}
      >
        {t(`pro.statuses.${status}`, status)}
      </Text>
      <BookingJourneyStepper
        status={status}
        booking={booking}
        history={history}
        labelNamespace="proRound2"
      />
    </View>
  );
}
