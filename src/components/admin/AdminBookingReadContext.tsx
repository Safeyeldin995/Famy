import { useTranslation } from "react-i18next";
import { useAdminBookingHistory } from "@/lib/db/admin-operation-queries";
import { useConversationByBooking, useMessages } from "@/lib/db/messaging";
import { AdminQueryError } from "./AdminQueryError";
import { operationDate } from "./operations";

export function AdminBookingReadContext({
  bookingId,
  status,
}: {
  bookingId: string;
  status?: string;
}) {
  const { t, i18n } = useTranslation();
  const history = useAdminBookingHistory(bookingId);
  const conversation = useConversationByBooking(bookingId, status);
  const messages = useMessages(conversation.data ?? undefined);
  return (
    <div className="space-y-4 rounded-xl bg-muted/40 p-3 text-sm">
      <h3 className="font-bold">{t("adminOps.timeline")}</h3>
      {history.isError ? (
        <AdminQueryError message={t("adminOps.loadError")} onRetry={() => history.refetch()} />
      ) : history.isLoading ? (
        <p>{t("adminOps.loading")}</p>
      ) : (
        <ol className="space-y-2">
          {(history.data ?? []).map((event) => (
            <li key={event.id}>
              <strong>
                {t(`adminOps.status.${event.to_status}`, { defaultValue: t("adminOps.unknown") })}
              </strong>
              <p className="text-xs text-muted-foreground">
                {operationDate(event.created_at, i18n.language)}
              </p>
              {event.reason && <p className="break-words">{event.reason}</p>}
            </li>
          ))}
          {!history.data?.length && <li>{t("adminOps.noHistory")}</li>}
        </ol>
      )}
      <h3 className="font-bold">{t("adminOps.chatReadOnly")}</h3>
      {conversation.isError || messages.isError ? (
        <AdminQueryError
          message={t("adminOps.loadError")}
          onRetry={() => {
            void conversation.refetch();
            if (conversation.data) void messages.refetch();
          }}
        />
      ) : conversation.isLoading || (conversation.data && messages.isLoading) ? (
        <p>{t("adminOps.loading")}</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {(messages.data ?? []).map((message) => (
            <li key={message.id} className="rounded-lg bg-surface p-3">
              <strong>
                {t(`adminOps.roles.${message.sender_role}`, {
                  defaultValue: t("adminOps.roles.system"),
                })}
              </strong>
              <p className="whitespace-pre-wrap break-words">
                {message.message_type === "system"
                  ? t(`bookingChat.system.${message.system_key}`, {
                      defaultValue: t("adminOps.systemEvent"),
                    })
                  : message.body}
              </p>
              <p className="text-xs text-muted-foreground">
                {operationDate(message.created_at, i18n.language)}
              </p>
            </li>
          ))}
          {!messages.data?.length && <li>{t("adminOps.noMessages")}</li>}
        </ul>
      )}
    </div>
  );
}
