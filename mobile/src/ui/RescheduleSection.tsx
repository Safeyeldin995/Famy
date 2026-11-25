import { useState } from "react";
import { space } from "./theme";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRescheduleAction, useRescheduleRequests } from "@/lib/rescheduleQueries";
import { dateTime } from "@/lib/presentation";
import { joinUiParts } from "@shared/format/uiJoin";
import { Field, QueryState, ui } from "./Page";
import { Text } from "./Text";
import { Button } from "./Button";
import { DateField } from "./DateField";
import { BottomSheetSelect } from "./provider/BottomSheetSelect";
import { scheduleTimeChoices, timeChoiceLabel } from "@shared/provider/scheduleDate";
import { formatBookingDurationLabel } from "@/lib/bookingDuration";
import { rescheduleErrorKey } from "@/lib/serverErrorMessages";

function rescheduleErrorMessage(error: unknown, t: (key: string) => string) {
  return t(rescheduleErrorKey(error));
}

export function RescheduleSection({
  booking,
  viewer = "customer",
}: {
  booking: { id: string; customer_id: string; status: string; start_at: string; end_at: string };
  viewer?: "customer" | "provider";
}) {
  const { t, i18n } = useTranslation();
  const requests = useRescheduleRequests(booking.id);
  const action = useRescheduleAction(booking.id);
  // The server refuses any change in session length: a reschedule only moves the start.
  const sessionMs = +new Date(booking.end_at) - +new Date(booking.start_at);
  const initial = new Date(booking.start_at);
  const [date, setDate] = useState(
    `${initial.getFullYear()}-${String(initial.getMonth() + 1).padStart(2, "0")}-${String(initial.getDate()).padStart(2, "0")}`,
  );
  const [time, setTime] = useState(
    `${String(initial.getHours()).padStart(2, "0")}:${String(initial.getMinutes()).padStart(2, "0")}`,
  );
  const [reason, setReason] = useState("");
  const [form, setForm] = useState<"" | "request" | "reject" | "withdraw" | "counter">("");
  const [history, setHistory] = useState(false);
  const open = requests.data?.find((row) => row.status === "pending");
  const requestedByCustomer = open ? open.requested_by === booking.customer_id : false;
  const awaitingMe = open
    ? viewer === "customer"
      ? !requestedByCustomer
      : requestedByCustomer
    : false;
  const isMine = open ? !awaitingMe : false;
  const eligible = ["pending", "confirmed"].includes(booking.status);
  const start = new Date(`${date}T${time}:00`);
  const valid = Number.isFinite(+start) && sessionMs > 0;
  const durationLabel = formatBookingDurationLabel(booking.start_at, booking.end_at, i18n.language, t);
  if (!eligible && !requests.data?.length && !requests.isError) return null;
  const perform = (input: Parameters<typeof action.mutate>[0]) =>
    action.mutate(input, {
      onSuccess: () => {
        setForm("");
        setReason("");
      },
    });
  return (
    <View style={[ui.card, { borderRadius: 16, gap: space.md }]}>
      <Text weight="bold">{t("reschedule.title")}</Text>
      <QueryState query={requests}>
        {open ? (
          <>
            <Text>
              {joinUiParts(
                [dateTime(open.proposed_start_at, i18n.language), dateTime(open.proposed_end_at, i18n.language)],
                i18n.language,
              )}
            </Text>
            {!!open.request_reason && (
              <Text size="sm" tone="muted">
                {open.request_reason}
              </Text>
            )}
            {awaitingMe ? (
              <View style={{ gap: space.sm }}>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button
                    style={{ flex: 1 }}
                    label={t("reschedule.accept")}
                    disabled={action.isPending}
                    onPress={() => perform({ type: "accept", requestId: open.id })}
                  />
                  <Button
                    style={{ flex: 1 }}
                    variant="secondary"
                    label={t("reschedule.reject")}
                    disabled={action.isPending}
                    onPress={() => setForm("reject")}
                  />
                </View>
                {viewer === "provider" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("reschedule.proposeOther")}
                    style={{ minHeight: 44, justifyContent: "center" }}
                    onPress={() => setForm("counter")}
                  >
                    <Text tone="brand" weight="heavy">
                      {t("reschedule.proposeOther")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <>
                <Text size="sm" tone="muted">
                  {t("reschedule.waiting")}
                </Text>
                {isMine ? (
                  <Button
                    variant="secondary"
                    label={t("reschedule.withdraw")}
                    onPress={() => setForm("withdraw")}
                    disabled={action.isPending}
                  />
                ) : null}
              </>
            )}
          </>
        ) : eligible && !form ? (
          viewer === "customer" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("reschedule.requestButton")}
              style={{ minHeight: 44, justifyContent: "center" }}
              onPress={() => setForm("request")}
            >
              <Text tone="brand" weight="heavy">
                {t("reschedule.requestButton")}
              </Text>
            </Pressable>
          ) : (
            <Text size="sm" tone="muted">
              {t("reschedule.noneOpen")}
            </Text>
          )
        ) : null}
        {form === "request" && !open && viewer === "customer" && (
          <>
            <DateField label={t("reschedule.proposedTime")} value={date} onChange={setDate} />
            <BottomSheetSelect
              label={t("pro.schedule.start")}
              value={time}
              options={scheduleTimeChoices(time, false).map((value) => ({
                value,
                label: timeChoiceLabel(value, i18n.language),
              }))}
              onChange={setTime}
            />
            <Text size="sm" tone="muted">
              {t("reschedule.sameDuration", { duration: durationLabel })}
            </Text>
            <Field label={t("reschedule.reasonOptional")} value={reason} onChangeText={setReason} />
            <Button
              label={t("reschedule.sendRequest")}
              loading={action.isPending}
              disabled={!valid}
              onPress={() => {
                if (valid)
                  perform({
                    type: "request",
                    start: start.toISOString(),
                    end: new Date(+start + sessionMs).toISOString(),
                    reason,
                  });
              }}
            />
          </>
        )}
        {form === "counter" && open && viewer === "provider" && (
          <>
            <DateField label={t("reschedule.proposedTime")} value={date} onChange={setDate} />
            <BottomSheetSelect
              label={t("pro.schedule.start")}
              value={time}
              options={scheduleTimeChoices(time, false).map((value) => ({
                value,
                label: timeChoiceLabel(value, i18n.language),
              }))}
              onChange={setTime}
            />
            <Text size="sm" tone="muted">
              {t("reschedule.sameDuration", { duration: durationLabel })}
            </Text>
            <Field label={t("reschedule.reasonOptional")} value={reason} onChangeText={setReason} />
            <Button
              label={t("reschedule.sendProposal")}
              disabled={!valid}
              loading={action.isPending}
              onPress={() => {
                if (valid)
                  perform({
                    type: "counter",
                    requestId: open.id,
                    start: start.toISOString(),
                    end: new Date(+start + sessionMs).toISOString(),
                    reason,
                  });
              }}
            />
          </>
        )}
        {(form === "reject" || form === "withdraw") && open && (
          <>
            <Text weight="bold">
              {t(form === "reject" ? "reschedule.rejectTitle" : "reschedule.withdrawTitle")}
            </Text>
            {form === "reject" && (
              <Field
                label={t("reschedule.rejectReasonPlaceholder")}
                value={reason}
                onChangeText={setReason}
              />
            )}
            <Button
              label={t(form === "reject" ? "reschedule.reject" : "reschedule.withdraw")}
              disabled={form === "reject" && !reason.trim()}
              loading={action.isPending}
              onPress={() => perform({ type: form, requestId: open.id, reason })}
            />
          </>
        )}
        {!!form && (
          <Button
            variant="secondary"
            label={t("common.cancel")}
            disabled={action.isPending}
            onPress={() => setForm("")}
          />
        )}
        {!!requests.data?.length && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("reschedule.history")}
            style={{ minHeight: 44, justifyContent: "center" }}
            onPress={() => setHistory(!history)}
          >
            <Text size="sm" weight="bold">
              {t("reschedule.history")}
            </Text>
          </Pressable>
        )}
        {history &&
          requests.data?.map((row) => (
            <Text key={row.id} size="xs" tone="muted">
              {joinUiParts(
                [
                  t(
                    row.requested_by === booking.customer_id
                      ? "reschedule.byCustomer"
                      : "reschedule.byProvider",
                  ),
                  dateTime(row.proposed_start_at, i18n.language),
                  dateTime(row.proposed_end_at, i18n.language),
                  t(`reschedule.status.${row.status}`),
                ],
                i18n.language,
              )}
            </Text>
          ))}
      </QueryState>
      {action.isError && (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {rescheduleErrorMessage(action.error, t)}
        </Text>
      )}
    </View>
  );
}
