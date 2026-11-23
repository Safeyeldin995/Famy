import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PhoneFrame, ErrorState } from "@/components/famio/ui";
import { CustomerPageHeader } from "@/components/famio/CustomerPageHeader";
import { OnlineSessionRoom } from "@/components/session/OnlineSessionRoom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/booking/$id/session")({
  component: BookingSessionPage,
});

function BookingSessionPage() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; token: string; url: string }
    | { status: "error"; code: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        if (!cancelled) setState({ status: "error", code: "unauthorized" });
        return;
      }
      const response = await fetch("/api/session/token", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bookingId: id }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        token?: string;
        url?: string;
        error?: string;
      };
      if (cancelled) return;
      if (!response.ok || !body.ok || !body.token || !body.url) {
        setState({ status: "error", code: body.error ?? "server_error" });
        return;
      }
      setState({ status: "ready", token: body.token, url: body.url });
    })().catch(() => {
      if (!cancelled) setState({ status: "error", code: "server_error" });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <PhoneFrame>
      <CustomerPageHeader
        title={t("onlineSession.title")}
        backTo={`/booking/${id}`}
      />
      <div className="flex flex-1 flex-col p-4">
        {state.status === "loading" ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : null}
        {state.status === "error" ? (
          <ErrorState
            title={t("onlineSession.joinFailed")}
            body={t("onlineSession.errors." + state.code, { defaultValue: state.code })}
            onRetry={() => navigate({ to: "/booking/$id", params: { id } })}
          />
        ) : null}
        {state.status === "ready" ? (
          <OnlineSessionRoom
            token={state.token}
            serverUrl={state.url}
            onLeave={() => navigate({ to: "/booking/$id", params: { id } })}
          />
        ) : null}
      </div>
    </PhoneFrame>
  );
}
