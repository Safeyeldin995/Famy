import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSession } from "@/lib/session";
import {
  useBookingReview,
  useSubmitReview,
  useCancelBooking,
  useCancellationReasons,
} from "@/lib/bookingQueries";
import { Button } from "./Button";
import { Text } from "./Text";
import { Choices, Field, QueryState, ui } from "./Page";
export function BookingActions({
  booking,
}: {
  booking: { id: string; provider_id: string; customer_id: string; status: string };
}) {
  const { t, i18n } = useTranslation();
  const { session } = useSession();
  const cancel = useCancelBooking();
  const reasons = useCancellationReasons();
  const review = useBookingReview(booking.status === "completed" ? booking.id : undefined);
  const submit = useSubmitReview();
  const [open, setOpen] = useState(false);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [rating, setRating] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  if (booking.customer_id !== session?.user.id) return null;
  const available = (reasons.data ?? []).filter((r) =>
    r.applicable_statuses.includes(booking.status),
  );
  const selected = available.find((r) => r.id === reasonId);
  const cancellable = booking.status === "pending" || booking.status === "confirmed";
  return (
    <View style={ui.card}>
      {error && <Text tone="danger">{error}</Text>}
      {cancellable && (
        <Button
          variant="secondary"
          label={t("bookingDetail.cancel")}
          onPress={() => setOpen(true)}
        />
      )}
      {open && cancellable && (
        <>
          <Text>{t("bookingDetail.cancelIrreversible")}</Text>
          <QueryState query={reasons} empty={!available.length} />
          <Choices
            label={t("bookingDetail.cancelReasonLabel")}
            value={reasonId}
            onChange={setReasonId}
            options={available.map((r) => ({
              value: r.id,
              label: i18n.language === "ar" ? r.name_ar : r.name_en,
            }))}
          />
          <Field
            label={t("bookingDetail.cancelReasonPlaceholder")}
            value={note}
            onChangeText={setNote}
            multiline
          />
          <Button
            label={t("bookingDetail.confirmAction")}
            disabled={!selected || (selected.requires_note && !note.trim())}
            loading={cancel.isPending}
            onPress={() =>
              cancel.mutate(
                { bookingId: booking.id, reasonId, note },
                {
                  onSuccess: () => setOpen(false),
                  onError: () => setError(t("common.somethingWentWrong")),
                },
              )
            }
          />
          <Button
            variant="secondary"
            label={t("bookingDetail.keep")}
            onPress={() => setOpen(false)}
          />
        </>
      )}
      {booking.status === "completed" && (
        <>
          <QueryState query={review} />
          {review.data ? (
            <>
              <Text>{t("mobile.reviewRating", { rating: String(review.data.rating) })}</Text>
              <Text>{review.data.comment}</Text>
            </>
          ) : (
            !review.isLoading &&
            !review.isError && (
              <>
                <Choices
                  label={t("mobileBooking.rating")}
                  value={rating}
                  onChange={setRating}
                  options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
                />
                <Field
                  label={t("mobileBooking.review")}
                  value={comment}
                  onChangeText={setComment}
                  multiline
                />
                <Button
                  label={t("bookingDetail.submitReview")}
                  disabled={!rating}
                  loading={submit.isPending}
                  onPress={() =>
                    submit.mutate(
                      {
                        bookingId: booking.id,
                        providerId: booking.provider_id,
                        rating: Number(rating),
                        comment,
                      },
                      { onError: () => setError(t("common.somethingWentWrong")) },
                    )
                  }
                />
              </>
            )
          )}
        </>
      )}
      <Button
        label={t("mobile.bookAgain")}
        onPress={() =>
          router.push({
            pathname: "/book/[providerId]",
            params: { providerId: booking.provider_id },
          })
        }
      />
    </View>
  );
}
