import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, View, StyleSheet, Pressable } from "react-native";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  registerGlobals,
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from "@livekit/react-native";
import { ConnectionQuality, Track } from "livekit-client";
import { useTranslation } from "react-i18next";
import { Text } from "./Text";
import { Button } from "./Button";
import { colors, space } from "./theme";
import { reportOnlineSessionAndLeave } from "@/lib/onlineSessionApi";
import { canOfferScreenShare, micButtonLabelKey } from "@/lib/onlineSessionUi";

let registered = false;

function SessionVideoTiles({ audioOnly }: { audioOnly: boolean }) {
  const { t } = useTranslation();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  if (audioOnly) {
    return (
      <View style={[styles.centered, { gap: space.sm, padding: space.md }]}>
        <Text weight="bold">{t("onlineSession.audioOnlyBanner")}</Text>
        <Text tone="muted" size="sm">
          {t("onlineSession.audioOnlyHint")}
        </Text>
      </View>
    );
  }
  if (tracks.length === 0) {
    return (
      <View style={styles.centered}>
        <Text tone="muted">{t("onlineSession.waitingForOther")}</Text>
      </View>
    );
  }
  return (
    <View style={styles.grid}>
      {tracks.map((trackRef) => (
        <VideoTrack key={trackRef.publication.trackSid} trackRef={trackRef} style={styles.tile} />
      ))}
    </View>
  );
}

function SessionCallControls({
  bookingId,
  party,
  audioOnly,
  setAudioOnly,
  onLeave,
}: {
  bookingId: string;
  party?: "customer" | "provider";
  audioOnly: boolean;
  setAudioOnly: (v: boolean) => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [reporting, setReporting] = useState(false);
  const [controlError, setControlError] = useState(false);

  useEffect(() => {
    const onQuality = () => {
      const quality = localParticipant.connectionQuality;
      if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) {
        setAudioOnly(true);
        localParticipant
          .setCameraEnabled(false)
          .then(() => setCamEnabled(false))
          .catch(() => setControlError(true));
      }
    };
    localParticipant.on("connectionQualityChanged", onQuality);
    return () => {
      localParticipant.off("connectionQualityChanged", onQuality);
    };
  }, [localParticipant, setAudioOnly]);

  const toggleMic = useCallback(async () => {
    const next = !micEnabled;
    try {
      await localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
      setControlError(false);
    } catch {
      setControlError(true);
    }
  }, [localParticipant, micEnabled]);

  const toggleCam = useCallback(async () => {
    const next = !camEnabled;
    try {
      await localParticipant.setCameraEnabled(next);
      setCamEnabled(next);
      setControlError(false);
      if (next) setAudioOnly(false);
    } catch {
      setControlError(true);
    }
  }, [camEnabled, localParticipant, setAudioOnly]);

  const flipCamera = useCallback(async () => {
    const pub = localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.videoTrack as { switchCamera?: () => Promise<void> } | undefined;
    try {
      if (track?.switchCamera) await track.switchCamera();
    } catch {
      setControlError(true);
    }
  }, [localParticipant]);

  const shareScreen = useCallback(() => {
    localParticipant.setScreenShareEnabled(true).catch(() => setControlError(true));
  }, [localParticipant]);

  const reportAndLeave = useCallback(async () => {
    setReporting(true);
    try {
      // The report is best effort: leaving must never hang on it.
      await reportOnlineSessionAndLeave({ bookingId });
    } finally {
      room.disconnect();
      onLeave();
    }
  }, [bookingId, onLeave, room]);

  return (
    <View style={styles.controls}>
      {controlError ? (
        <Text tone="danger" size="sm">
          {t("onlineSession.controlFailed")}
        </Text>
      ) : null}
      <Pressable
        style={styles.controlBtn}
        onPress={toggleMic}
        accessibilityRole="button"
        accessibilityLabel={t(micButtonLabelKey(micEnabled))}
      >
        <Text>{t(micButtonLabelKey(micEnabled))}</Text>
      </Pressable>
      <Pressable
        style={styles.controlBtn}
        onPress={toggleCam}
        accessibilityRole="button"
        accessibilityLabel={camEnabled ? t("onlineSession.cameraOn") : t("onlineSession.cameraOff")}
      >
        <Text>{camEnabled ? t("onlineSession.cameraOn") : t("onlineSession.cameraOff")}</Text>
      </Pressable>
      <Pressable
        style={styles.controlBtn}
        onPress={flipCamera}
        accessibilityRole="button"
        accessibilityLabel={t("onlineSession.flipCamera")}
      >
        <Text>{t("onlineSession.flipCamera")}</Text>
      </Pressable>
      {canOfferScreenShare(Platform.OS, party) ? (
        <Pressable
          style={styles.controlBtn}
          onPress={shareScreen}
          accessibilityRole="button"
          accessibilityLabel={t("onlineSession.screenShare")}
        >
          <Text>{t("onlineSession.screenShare")}</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={[styles.controlBtn, styles.reportBtn]}
        onPress={reportAndLeave}
        disabled={reporting}
        accessibilityRole="button"
        accessibilityLabel={t("onlineSession.reportAndLeave")}
      >
        <Text tone="danger">{t("onlineSession.reportAndLeave")}</Text>
      </Pressable>
      <Button label={t("onlineSession.leave")} variant="secondary" onPress={() => room.disconnect()} />
    </View>
  );
}

type Props = {
  bookingId: string;
  token: string;
  serverUrl: string;
  party?: "customer" | "provider";
  onLeave: () => void;
};

function openAppSettings() {
  if (Platform.OS === "ios") void Linking.openURL("app-settings:");
  else void Linking.openSettings();
}

function SessionErrorPanel({
  kind,
  onRetry,
  onLeave,
}: {
  kind: "media" | "room";
  onRetry: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.centered, { gap: space.md, padding: space.lg }]}>
      <Text weight="bold" style={{ textAlign: "center" }}>
        {kind === "media" ? t("onlineSession.mediaErrorTitle") : t("onlineSession.roomErrorTitle")}
      </Text>
      <Text tone="muted" style={{ textAlign: "center" }}>
        {kind === "media" ? t("onlineSession.mediaErrorBody") : t("onlineSession.roomErrorBody")}
      </Text>
      {kind === "media" ? (
        <Button label={t("onlineSession.openSettings")} variant="secondary" onPress={openAppSettings} />
      ) : null}
      <Button label={t("onlineSession.retry")} onPress={onRetry} />
      <Button label={t("onlineSession.leave")} variant="secondary" onPress={onLeave} />
    </View>
  );
}

export function OnlineSessionRoom({ bookingId, token, serverUrl, party, onLeave }: Props) {
  const { t } = useTranslation();
  const [audioOnly, setAudioOnly] = useState(false);
  const [failure, setFailure] = useState<"media" | "room" | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Tearing the room down to show an error must not count as the user leaving.
  const tearingDown = useRef(false);

  const fail = useCallback((kind: "media" | "room") => {
    tearingDown.current = true;
    setFailure(kind);
  }, []);

  const retry = useCallback(() => {
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  const handleDisconnected = useCallback(() => {
    if (tearingDown.current) return;
    onLeave();
  }, [onLeave]);

  useEffect(() => {
    if (!registered) {
      registerGlobals();
      registered = true;
    }
    AudioSession.startAudioSession();
    return () => {
      AudioSession.stopAudioSession();
    };
  }, []);

  if (failure) {
    return <SessionErrorPanel kind={failure} onRetry={retry} onLeave={onLeave} />;
  }

  return (
    <LiveKitRoom
      key={attempt}
      serverUrl={serverUrl}
      token={token}
      connect
      audio
      video={!audioOnly}
      options={{
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          simulcast: true,
          videoEncoding: { maxBitrate: 900_000, maxFramerate: 30 },
        },
      }}
      onConnected={() => {
        tearingDown.current = false;
      }}
      onDisconnected={handleDisconnected}
      onError={() => fail("room")}
      onMediaDeviceFailure={() => fail("media")}
    >
      <View style={styles.wrap}>
        <Text size="lg" weight="bold">
          {t("onlineSession.title")}
        </Text>
        <SessionVideoTiles audioOnly={audioOnly} />
        <SessionCallControls
          bookingId={bookingId}
          party={party}
          audioOnly={audioOnly}
          setAudioOnly={setAudioOnly}
          onLeave={onLeave}
        />
      </View>
    </LiveKitRoom>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: space.md, paddingVertical: space.md },
  grid: { flex: 1, gap: space.sm },
  tile: {
    flex: 1,
    minHeight: 200,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: colors.brandTint,
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  controls: { gap: space.sm },
  controlBtn: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reportBtn: { borderColor: colors.destructive },
});