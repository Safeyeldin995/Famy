import { useEffect, useRef, useState } from "react";
import { Room } from "livekit-client";
import { useTranslation } from "react-i18next";
import { PrimaryButton } from "@/components/famio/ui";
import { fetchOnlineSessionToken } from "@/lib/online/onlineSessionApi";

type Props = {
  bookingId: string;
  displayName?: string;
  onLeave: () => void;
};

export function OnlineWebSessionRoom({ bookingId, displayName, onLeave }: Props) {
  const { t } = useTranslation();
  const roomRef = useRef<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await fetchOnlineSessionToken({ bookingId, displayName });
      if (cancelled) return;
      if (!token.ok) {
        setError(token.error);
        setConnecting(false);
        return;
      }
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      try {
        await room.connect(token.url, token.token);
        await room.localParticipant.setMicrophoneEnabled(true);
        await room.localParticipant.setCameraEnabled(true);
        setConnecting(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "connect_failed");
        setConnecting(false);
      }
    })();
    return () => {
      cancelled = true;
      void roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [bookingId, displayName]);

  return (
    <div className="flex min-h-[60vh] flex-col rounded-3xl bg-navy text-white">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        {connecting ? <p>{t("common.loading")}</p> : null}
        {error ? <p className="text-pro-14 text-coral">{error}</p> : null}
        {!error && !connecting ? (
          <p className="text-pro-15 font-bold">{t("onlineWeb.walkthrough.roomLive")}</p>
        ) : null}
      </div>
      <div className="border-t border-white/10 p-4">
        <PrimaryButton className="h-11 w-full" onClick={onLeave}>
          {t("onlineSession.leave")}
        </PrimaryButton>
      </div>
    </div>
  );
}