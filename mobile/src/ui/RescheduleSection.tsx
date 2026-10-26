import { useState } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRescheduleAction, useRescheduleRequests } from "@/lib/rescheduleQueries";
import { dateTime } from "@/lib/presentation";
import { Field, QueryState, ui } from "./Page";
import { Text } from "./Text";
import { Button } from "./Button";
import { DateField } from "./DateField";
import { BottomSheetSelect } from "./provider/BottomSheetSelect";
import { scheduleTimeChoices, timeChoiceLabel } from "@shared/provider/scheduleDate";

export function RescheduleSection({
  booking,
}: {
  booking: { id: string; customer_id: string; status: string; start_at: string; end_at: string };
}) {
  const { t, i18n } = useTranslation();
  const requests = useRescheduleRequests(booking.id);
  const action = useRescheduleAction(booking.id);
  const initial = new Date(booking.start_at);
  const [date, setDate] = useState(
    `${initial.getFullYear()}-${String(initial.getMonth() + 1).padStart(2, "0")}-${String(initial.getDate()).padStart(2, "0")}`,
  );
  const [time, setTime] = useState(
    `${String(initial.getHours()).padStart(2, "0")}:${String(initial.getMinutes()).padStart(2, "0")}`,
  );
  const [hours, setHours] = useState(
    String(Math.max(1, Math.round((+new Date(booking.end_at) - +initial) / 3600000))),
  );
  const [reason, setReason] = useState("");
  const [form, setForm] = useState<"" | "request" | "reject" | "withdraw">("");
  const [history, setHistory] = useState(false);
  const open = requests.data?.find((row) => row.status === "pending");
  const mine = open?.requested_by === booking.customer_id;
  const eligible = ["pending", "confirmed"].includes(booking.status);
  const start = new Date(`${date}T${time}:00`);
  const valid = Number.isFinite(+start) && Number.isInteger(Number(hours)) && Number(hours) >= 1;
  if (!eligible && !requests.data?.length && !requests.isError) return null;
  const perform = (input: Parameters<typeof action.mutate>[0]) =>
    action.mutate(input, {
      onSuccess: () => {
        setForm("");
        setReason("");
      },
    });
  return (
    <View style={[ui.card, { borderRadius: 16, gap: 12 }]}>
      <Text weight="bold">{t("reschedule.title")}</Text>
      <QueryState query={requests}>
        {open ? (
          <>
            <Text>{dateTime(open.proposed_start_at, i18n.language)}</Text>
            {!!open.reason && (
              <Text size="sm" tone="muted">
                {open.reason}
              </Text>
            )}
            {mine ? (
              <>
                <Text size="sm" tone="muted">
                  {t("reschedule.waiting")}
                </Text>
                <Button
                  variant="secondary"
                  label={t("reschedule.withdraw")}
                  onPress={() => setForm("withdraw")}
                  disabled={action.isPending}
                />
              </>
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
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
            )}
          </>
        ) : eligible && !form ? (
          <Pressable
            accessibilityRole="button"
            style={{ minHeight: 44, justifyContent: "center" }}
            onPress={() => setForm("request")}
          >
            <Text tone="brand" weight="heavy">
              {t("reschedule.requestButton")}
            </Text>
          </Pressable>
        ) : null}
        {form === "request" && !open && (
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
            <Field
              label={t("reschedule.durationHours")}
              value={hours}
              onChangeText={setHours}
              keyboardType="number-pad"
            />
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
                    end: new Date(+start + Number(hours) * 3600000).toISOString(),
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
              {t(
                row.requested_by === booking.customer_id
                  ? "reschedule.byCustomer"
                  : "reschedule.byProvider",
              )}{" "}
              · {dateTime(row.proposed_start_at, i18n.language)} ·{" "}
              {t(`reschedule.status.${row.status}`)}
            </Text>
          ))}
      </QueryState>
      {action.isError && (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {t("common.somethingWentWrong")}
        </Text>
      )}
    </View>
  );
}
