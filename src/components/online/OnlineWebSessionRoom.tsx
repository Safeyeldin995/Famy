import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import { useTranslation } from "react-i18next";
import { PrimaryButton } from "@/components/famio/ui";
import { fetchOnlineSessionToken } from "@/lib/online/onlineSessionApi";

type Props = {
  bookingId: string;
  displayName?: string;
  onLeave: () => void;
};

function syncRemoteTracks(room: Room, remoteVideoHost: HTMLDivElement, audioHost: HTMLDivElement) {
  audioHost.innerHTML = "";
  remoteVideoHost.innerHTML = "";
  room.remoteParticipants.forEach((participant: RemoteParticipant) => {
    participant.trackPublications.forEach((publication: RemoteTrackPublication) => {
      if (!publication.isSubscribed || !publication.track) return;
      attachRemoteTrack(publication.track, remoteVideoHost, audioHost);
    });
  });
}

function attachRemoteTrack(track: RemoteTrack, remoteVideoHost: HTMLDivElement, audioHost: HTMLDivElement) {
  const element = track.attach();
  if (track.kind === Track.Kind.Video) {
    element.className = "h-full w-full object-cover";
    const tile = document.createElement("div");
    tile.className = "relative aspect-video w-full overflow-hidden rounded-2xl bg-black";
    tile.appendChild(element);
    remoteVideoHost.appendChild(tile);
  } else if (track.kind === Track.Kind.Audio) {
    element.setAttribute("data-lk-remote-audio", "1");
    audioHost.appendChild(element);
  }
}

export function OnlineWebSessionRoom({ bookingId, displayName, onLeave }: Props) {
  const { t } = useTranslation();
  const roomRef = useRef<Room | null>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);
  const remoteAudioRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micEnabled;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicEnabled(next);
  }, [micEnabled]);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    const localVideo = localVideoRef.current;
    if (!room) return;
    const next = !camEnabled;
    await room.localParticipant.setCameraEnabled(next);
    setCamEnabled(next);
    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.track;
    if (next && track && track.kind === Track.Kind.Video && localVideo) {
      track.attach(localVideo);
    } else if (!next && track) {
      track.detach().forEach((el) => el.remove());
    }
  }, [camEnabled]);

  useEffect(() => {
    const localVideo = localVideoRef.current;
    const remoteVideoHost = remoteVideoRef.current;
    const audioHost = remoteAudioRef.current;
    if (!localVideo || !remoteVideoHost || !audioHost) return;

    let cancelled = false;
    const onTrackSubscribed = (
      track: RemoteTrack,
      _publication: RemoteTrackPublication,
      _participant: RemoteParticipant,
    ) => {
      attachRemoteTrack(track, remoteVideoHost, audioHost);
    };
    const onTrackUnsubscribed = (track: RemoteTrack) => {
      track.detach().forEach((el) => el.remove());
    };

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
      room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      try {
        await room.connect(token.url, token.token);
        await room.localParticipant.setMicrophoneEnabled(true);
        await room.localParticipant.setCameraEnabled(true);
        const cameraPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        const localTrack = cameraPub?.track;
        if (localTrack && localTrack.kind === Track.Kind.Video && localVideo) {
          localTrack.attach(localVideo);
        }
        syncRemoteTracks(room, remoteVideoHost, audioHost);
        setConnecting(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "connect_failed");
        setConnecting(false);
      }
    })();

    return () => {
      cancelled = true;
      const room = roomRef.current;
      room?.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room?.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      void room?.disconnect();
      roomRef.current = null;
    };
  }, [bookingId, displayName]);

  return (
    <div className="flex min-h-[60vh] flex-col rounded-3xl bg-navy text-white">
      <div className="grid flex-1 gap-3 p-4 md:grid-cols-2">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-black/40">
          <video ref={localVideoRef} playsInline autoPlay muted className="h-full w-full object-cover" />
          <p className="absolute bottom-2 start-2 rounded bg-black/50 px-2 py-1 text-pro-12">{t("onlineSession.preJoinCamera")}</p>
        </div>
        <div ref={remoteVideoRef} className="relative min-h-[12rem] space-y-2 overflow-hidden rounded-2xl bg-black/40 p-2">
          {!connecting && !error ? (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-pro-13 text-white/70 empty:hidden">
              {/* placeholder cleared when remote tiles mount */}
            </p>
          ) : null}
        </div>
      </div>
      <div ref={remoteAudioRef} className="sr-only" aria-hidden />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        {connecting ? <p>{t("common.loading")}</p> : null}
        {error ? <p className="text-pro-14 text-coral">{error}</p> : null}
        {!error && !connecting ? (
          <p className="text-pro-15 font-bold">{t("onlineWeb.walkthrough.roomLive")}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-white/10 p-4">
        <button
          type="button"
          className="rounded-full bg-white/10 px-4 py-2 text-pro-13 font-bold"
          onClick={() => void toggleMic()}
        >
          {micEnabled ? t("onlineSession.mute") : t("onlineSession.unmute")}
        </button>
        <button
          type="button"
          className="rounded-full bg-white/10 px-4 py-2 text-pro-13 font-bold"
          onClick={() => void toggleCam()}
        >
          {camEnabled ? t("onlineSession.preJoinCamera") : t("onlineSession.audioOnlyBanner")}
        </button>
        <PrimaryButton className="ms-auto h-11 min-w-[8rem]" onClick={onLeave}>
          {t("onlineSession.leave")}
        </PrimaryButton>
      </div>
    </div>
  );
}