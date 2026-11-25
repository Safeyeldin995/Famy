import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  useBookingCases,
  useCreateSupportTicket,
  useOpenDispute,
  useReportNoShow,
} from "@/lib/caseQueries";
import { customerProblemOptions, isCaseDescriptionValid } from "@/lib/customerCasesPure";
import { dateTime } from "@/lib/presentation";
import { Button } from "./Button";
import { Text } from "./Text";
import { Field, ui } from "./Page";
import { useToast } from "./Toast";
import { space } from "./theme";

type Kind = "no_show" | "dispute" | "support";

/** Admin's reply on a case, if any (disputes/no-shows use admin_notes, tickets resolution_notes). */
function caseNote(c: { admin_notes?: string | null; resolution_notes?: string | null }): string {
  return (c.admin_notes ?? c.resolution_notes ?? "").trim();
}

/**
 * «في مشكلة؟» on a customer's booking: report a provider no-show, open a
 * complaint (dispute) or contact support, and see the status of any case
 * already opened. The database RPCs decide what is allowed; this screen only
 * shows the options that will be accepted.
 */
export function BookingProblem({
  booking,
}: {
  booking: { id: string; status: string; service_mode?: string | null };
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const cases = useBookingCases(booking.id);
  const noShow = useReportNoShow();
  const dispute = useOpenDispute();
  const ticket = useCreateSupportTicket();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const options = customerProblemOptions({
    bookingStatus: booking.status,
    serviceMode: booking.service_mode,
    noShowReports: cases.data?.noShows,
    disputes: cases.data?.disputes,
  });

  const existing = [
    ...(cases.data?.noShows ?? []).map((c) => ({ ...c, kindKey: "bookingProblem.kindNoShow" })),
    ...(cases.data?.disputes ?? []).map((c) => ({ ...c, kindKey: "bookingProblem.kindDispute" })),
    ...(cases.data?.tickets ?? []).map((c) => ({ ...c, kindKey: "bookingProblem.kindSupport" })),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const busy = noShow.isPending || dispute.isPending || ticket.isPending;
  const needsLongText = kind === "dispute" || kind === "support";
  const canSend =
    !!kind && (needsLongText ? isCaseDescriptionValid(text) : text.trim().length > 0);

  function reset() {
    setKind(null);
    setText("");
    setError("");
  }

  function send() {
    if (!kind || !canSend) return;
    setError("");
    const onSuccess = () => {
      reset();
      setOpen(false);
      toast.show(t("bookingProblem.sent"));
    };
    const onError = () => setError(t("bookingProblem.sendFailed"));
    const reason = text.trim();
    if (kind === "no_show") {
      noShow.mutate({ bookingId: booking.id, reason }, { onSuccess, onError });
    } else if (kind === "dispute") {
      dispute.mutate(
        { bookingId: booking.id, reason: t("bookingProblem.disputeReason"), description: reason },
        { onSuccess, onError },
      );
    } else {
      ticket.mutate(
        {
          bookingId: booking.id,
          category: "booking_issue",
          subject: t("bookingProblem.supportSubject"),
          description: reason,
        },
        { onSuccess, onError },
      );
    }
  }

  return (
    <View style={{ gap: space.md }}>
      {existing.length > 0 ? (
        <View style={[ui.card, { gap: space.sm }]}>
          <Text weight="bold">{t("bookingProblem.casesTitle")}</Text>
          {existing.map((c) => (
            <View key={c.id} style={{ gap: space.xs }}>
              <Text size="sm" weight="bold">
                {t(c.kindKey)} · {t(`bookingProblem.status.${c.status}`, { defaultValue: c.status })}
              </Text>
              <Text size="xs" tone="muted">
                {dateTime(c.created_at, i18n.language)}
              </Text>
              {caseNote(c) ? <Text size="sm">{caseNote(c)}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {!open ? (
        <Button
          variant="secondary"
          label={t("bookingProblem.open")}
          onPress={() => {
            reset();
            setOpen(true);
          }}
        />
      ) : (
        <View style={[ui.card, { gap: space.md }]}>
          <Text weight="bold">{t("bookingProblem.title")}</Text>
          {!kind ? (
            <>
              {options.noShow ? (
                <Button
                  variant="secondary"
                  label={t("bookingProblem.noShow")}
                  onPress={() => setKind("no_show")}
                />
              ) : null}
              {options.dispute ? (
                <Button
                  variant="secondary"
                  label={t("bookingProblem.dispute")}
                  onPress={() => setKind("dispute")}
                />
              ) : null}
              <Button
                variant="secondary"
                label={t("bookingProblem.support")}
                onPress={() => setKind("support")}
              />
            </>
          ) : (
            <>
              <Text size="sm" tone="muted">
                {t(
                  kind === "no_show"
                    ? "bookingProblem.noShowHint"
                    : kind === "dispute"
                      ? "bookingProblem.disputeHint"
                      : "bookingProblem.supportHint",
                )}
              </Text>
              <Field
                label={t("bookingProblem.details")}
                value={text}
                onChangeText={setText}
                multiline
              />
              {needsLongText && text.length > 0 && !isCaseDescriptionValid(text) ? (
                <Text size="xs" tone="muted">
                  {t("bookingProblem.minLength")}
                </Text>
              ) : null}
              {error ? <Text tone="danger">{error}</Text> : null}
              <Button
                label={t("bookingProblem.send")}
                disabled={!canSend}
                loading={busy}
                onPress={send}
              />
              <Button variant="secondary" label={t("common.back")} onPress={reset} />
            </>
          )}
          <Button
            variant="secondary"
            label={t("bookingProblem.close")}
            onPress={() => {
              reset();
              setOpen(false);
            }}
          />
        </View>
      )}
    </View>
  );
}
