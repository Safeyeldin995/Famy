import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PrimaryButton } from "@/components/famio/ui";
import { fetchOnlineSessionToken } from "@/lib/online/onlineSessionApi";
import { onlineSessionTokenErrorKey, isMediaDeviceErrorMessage } from "@/lib/online/onlineWebSessionMessage";
import { sessionJoinWindow } from "@/lib/livekit/sessionAccess";
import { OnlineWebSessionPreJoin, type PreJoinChoice } from "@/components/online/OnlineWebSessionPreJoin";

type Props = {
  bookingId: string;
  displayName?: string;
  startAt: Date;
  endAt: Date;
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

const REMOTE_TILE_ATTR = "data-lk-remote-tile";

/**
 * Detach a track from every media element. Elements this module created for remote
 * tracks (and their tiles) are removed; React-owned elements such as the local
 * preview are only cleared, so they can be re-attached when the camera comes back.
 */
export function detachTrackElements(
  track: { detach: () => HTMLMediaElement[] },
  reactOwned: HTMLMediaElement | null,
) {
  for (const el of track.detach()) {
    if (el === reactOwned) {
      el.srcObject = null;
      continue;
    }
    const tile = el.parentElement?.hasAttribute(REMOTE_TILE_ATTR) ? el.parentElement : null;
    el.remove();
    tile?.remove();
  }
}

function attachRemoteTrack(track: RemoteTrack, remoteVideoHost: HTMLDivElement, audioHost: HTMLDivElement) {
  const element = track.attach();
  if (track.kind === Track.Kind.Video) {
    element.className = "h-full w-full object-cover";
    const tile = document.createElement("div");
    tile.setAttribute(REMOTE_TILE_ATTR, "1");
    tile.className = "relative aspect-video w-full overflow-hidden rounded-2xl bg-black";
    tile.appendChild(element);
    remoteVideoHost.appendChild(tile);
  } else if (track.kind === Track.Kind.Audio) {
    element.setAttribute("data-lk-remote-audio", "1");
    audioHost.appendChild(element);
  }
}

type Phase = "prejoin" | "connecting" | "live" | "error";

export function OnlineWebSessionRoom({ bookingId, displayName, startAt, endAt, onLeave }: Props) {
  const { t } = useTranslation();
  const roomRef = useRef<Room | null>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);
  const remoteAudioRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("prejoin");
  const [prejoin, setPrejoin] = useState<PreJoinChoice | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mediaRetry, setMediaRetry] = useState(false);
  const [audioOnly, setAudioOnly] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [remoteCount, setRemoteCount] = useState(0);
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [countdownLabel, setCountdownLabel] = useState<string | null>(null);
  const joinWindow = sessionJoinWindow(startAt, endAt);
  const connectStartedRef = useRef(false);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micEnabled;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
    } catch {
      toast.error(t("onlineSession.controlFailed"));
    }
  }, [micEnabled, t]);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    const localVideo = localVideoRef.current;
    if (!room) return;
    const next = !camEnabled;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCamEnabled(next);
      setAudioOnly(!next);
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const track = pub?.track;
      if (next && track && track.kind === Track.Kind.Video && localVideo) {
        track.attach(localVideo);
      } else if (!next && track) {
        detachTrackElements(track, localVideo);
      }
    } catch {
      toast.error(t("onlineSession.controlFailed"));
    }
  }, [camEnabled, t]);

  const teardownRoom = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    room.removeAllListeners();
    void room.disconnect();
    roomRef.current = null;
  }, []);

  const connectLive = useCallback(
    async (choice: PreJoinChoice) => {
      const localVideo = localVideoRef.current;
      const remoteVideoHost = remoteVideoRef.current;
      const audioHost = remoteAudioRef.current;
      if (!remoteVideoHost || !audioHost) return;

      teardownRoom();
      setErrorMessage(null);
      setMediaRetry(false);
      setAudioOnly(choice.audioOnly);

      const token = await fetchOnlineSessionToken({ bookingId, displayName });
      if (token.ok === false) {
        const key = onlineSessionTokenErrorKey(token.error);
        setErrorMessage(key ? t(key) : t("onlineSession.errors.server_error"));
        setPhase("error");
        return;
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      const refreshRemoteCount = () => setRemoteCount(room.remoteParticipants.size);
      const onTrackSubscribed = (
        track: RemoteTrack,
        _publication: RemoteTrackPublication,
        _participant: RemoteParticipant,
      ) => {
        attachRemoteTrack(track, remoteVideoHost, audioHost);
        refreshRemoteCount();
      };
      const onTrackUnsubscribed = (track: RemoteTrack) => {
        detachTrackElements(track, null);
      };
      const onParticipantChange = () => refreshRemoteCount();

      room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.on(RoomEvent.ParticipantConnected, onParticipantChange);
      room.on(RoomEvent.ParticipantDisconnected, onParticipantChange);
      room.on(RoomEvent.ConnectionStateChanged, (s) => setConnState(s));

      try {
        await room.connect(token.url, token.token);
        await room.localParticipant.setMicrophoneEnabled(true);
        if (!choice.audioOnly) {
          await room.localParticipant.setCameraEnabled(true);
          const cameraPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
          const localTrack = cameraPub?.track;
          if (localTrack && localTrack.kind === Track.Kind.Video && localVideo) {
            localTrack.attach(localVideo);
          }
          setCamEnabled(true);
        } else {
          await room.localParticipant.setCameraEnabled(false);
          setCamEnabled(false);
        }
        syncRemoteTracks(room, remoteVideoHost, audioHost);
        refreshRemoteCount();
        setPhase("live");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "connect_failed";
        if (isMediaDeviceErrorMessage(msg)) {
          setMediaRetry(true);
          setErrorMessage(t("onlineSession.mediaErrorBody"));
        } else {
          setErrorMessage(t("onlineSession.roomErrorBody"));
        }
        setPhase("error");
        teardownRoom();
      }
    },
    [bookingId, displayName, t, teardownRoom],
  );

  useEffect(() => {
    return () => teardownRoom();
  }, [teardownRoom]);

  useEffect(() => {
    if (phase === "prejoin") connectStartedRef.current = false;
  }, [phase]);

  useEffect(() => {
    if (phase !== "connecting" || !prejoin || connectStartedRef.current) return;
    connectStartedRef.current = true;
    void connectLive(prejoin);
  }, [phase, prejoin, connectLive]);

  useEffect(() => {
    if (phase !== "live") return;
    const tick = () => {
      const now = Date.now();
      if (now > joinWindow.closesAt.getTime()) {
        teardownRoom();
        onLeave();
        return;
      }
      const remaining = Math.max(0, endAt.getTime() - now);
      const mins = Math.ceil(remaining / 60_000);
      setCountdownLabel(
        mins > 0 ? t("onlineWeb.session.lessonEndsIn", { minutes: String(mins) }) : null,
      );
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [phase, endAt, joinWindow.closesAt, onLeave, t, teardownRoom]);

  if (phase === "prejoin") {
    return (
      <OnlineWebSessionPreJoin
        onCancel={onLeave}
        onReady={(choice) => {
          setPrejoin(choice);
          setPhase("connecting");
        }}
      />
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col rounded-3xl bg-navy text-white">
      {connState === ConnectionState.Reconnecting ? (
        <div className="bg-coral/90 px-4 py-2 text-center text-pro-13 font-bold">
          {t("onlineWeb.session.reconnecting")}
        </div>
      ) : null}
      {connState === ConnectionState.Disconnected && phase === "live" ? (
        <div className="flex flex-wrap items-center justify-center gap-2 bg-coral/90 px-4 py-2 text-pro-13">
          <span>{t("onlineWeb.session.disconnected")}</span>
          <button
            type="button"
            className="underline"
            onClick={() => {
              if (!prejoin) return;
              connectStartedRef.current = false;
              setPhase("connecting");
            }}
          >
            {t("onlineWeb.session.rejoin")}
          </button>
        </div>
      ) : null}
      <div className="grid flex-1 gap-3 p-4 md:grid-cols-2">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-black/40">
          {!audioOnly ? (
            <video ref={localVideoRef} playsInline autoPlay muted className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-pro-13 text-white/80">
              {t("onlineSession.audioOnlyBanner")}
            </div>
          )}
          <p className="absolute bottom-2 start-2 rounded bg-black/50 px-2 py-1 text-pro-12">{t("onlineSession.preJoinCamera")}</p>
        </div>
        <div ref={remoteVideoRef} className="relative min-h-[12rem] space-y-2 overflow-hidden rounded-2xl bg-black/40 p-2">
          {phase === "live" && remoteCount === 0 ? (
            <p className="flex min-h-[10rem] items-center justify-center text-pro-13 text-white/70">
              {t("onlineSession.waitingForOther")}
            </p>
          ) : null}
        </div>
      </div>
      <div ref={remoteAudioRef} className="sr-only" aria-hidden />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        {phase === "connecting" ? <p>{t("common.loading")}</p> : null}
        {errorMessage ? (
          <div className="max-w-md space-y-3 text-center">
            <p className="text-pro-14 text-coral">{errorMessage}</p>
            {mediaRetry ? (
              <div className="flex flex-wrap justify-center gap-2">
                <PrimaryButton
                  className="h-10"
                  onClick={() => {
                    setPrejoin({ audioOnly: true });
                    connectStartedRef.current = false;
                    setPhase("connecting");
                  }}
                >
                  {t("onlineWeb.session.continueAudioOnly")}
                </PrimaryButton>
                <button
                  type="button"
                  className="text-pro-13 font-bold underline"
                  onClick={() => {
                    if (!prejoin) return;
                    connectStartedRef.current = false;
                    setPhase("connecting");
                  }}
                >
                  {t("onlineSession.retry")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="text-pro-13 font-bold underline"
                onClick={() => {
                  if (!prejoin) return;
                  connectStartedRef.current = false;
                  setPhase("connecting");
                }}
              >
                {t("onlineSession.retry")}
              </button>
            )}
          </div>
        ) : null}
        {phase === "live" && !errorMessage ? (
          <>
            <p className="text-pro-15 font-bold">{t("onlineWeb.walkthrough.roomLive")}</p>
            {countdownLabel ? <p className="text-pro-13 text-white/70">{countdownLabel}</p> : null}
          </>
        ) : null}
      </div>
      {phase === "live" && !errorMessage ? (
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
            {camEnabled ? t("onlineSession.cameraOff") : t("onlineSession.cameraOn")}
          </button>
          <PrimaryButton className="ms-auto h-11 min-w-[8rem]" onClick={onLeave}>
            {t("onlineSession.leave")}
          </PrimaryButton>
        </div>
      ) : null}
    </div>
  );
}