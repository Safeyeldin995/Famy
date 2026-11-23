import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
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

let registered = false;

function SessionVideoTiles({ audioOnly }: { audioOnly: boolean }) {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  if (audioOnly) {
    return (
      <View style={styles.centered}>
        <Text tone="muted">{/* audio-only fallback active */}</Text>
      </View>
    );
  }
  if (tracks.length === 0) {
    return (
      <View style={styles.centered}>
        <Text tone="muted">{/* waiting for video */}</Text>
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
  audioOnly,
  setAudioOnly,
  onLeave,
}: {
  bookingId: string;
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

  useEffect(() => {
  const onQuality = () => {
      const quality = localParticipant.connectionQuality;
      if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) {
        setAudioOnly(true);
        void localParticipant.setCameraEnabled(false);
        setCamEnabled(false);
      }
    };
    localParticipant.on("connectionQualityChanged", onQuality);
    return () => {
      localParticipant.off("connectionQualityChanged", onQuality);
    };
  }, [localParticipant, setAudioOnly]);

  const toggleMic = useCallback(async () => {
    const next = !micEnabled;
    await localParticipant.setMicrophoneEnabled(next);
    setMicEnabled(next);
  }, [localParticipant, micEnabled]);

  const toggleCam = useCallback(async () => {
    const next = !camEnabled;
    await localParticipant.setCameraEnabled(next);
    setCamEnabled(next);
    if (next) setAudioOnly(false);
  }, [camEnabled, localParticipant, setAudioOnly]);

  const flipCamera = useCallback(async () => {
    const pub = localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.videoTrack as { switchCamera?: () => Promise<void> } | undefined;
    if (track?.switchCamera) await track.switchCamera();
  }, [localParticipant]);

  const reportAndLeave = useCallback(async () => {
    setReporting(true);
    await reportOnlineSessionAndLeave({ bookingId });
    room.disconnect();
    onLeave();
  }, [bookingId, onLeave, room]);

  return (
    <View style={styles.controls}>
      <Pressable style={styles.controlBtn} onPress={toggleMic} accessibilityRole="button">
        <Text>{micEnabled ? t("onlineSession.unmute") : t("onlineSession.mute")}</Text>
      </Pressable>
      <Pressable style={styles.controlBtn} onPress={toggleCam} accessibilityRole="button">
        <Text>{camEnabled ? t("onlineSession.cameraOn") : t("onlineSession.cameraOff")}</Text>
      </Pressable>
      <Pressable style={styles.controlBtn} onPress={flipCamera} accessibilityRole="button">
        <Text>{t("onlineSession.flipCamera")}</Text>
      </Pressable>
      <Pressable
        style={[styles.controlBtn, styles.reportBtn]}
        onPress={reportAndLeave}
        disabled={reporting}
        accessibilityRole="button"
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
  onLeave: () => void;
};

export function OnlineSessionRoom({ bookingId, token, serverUrl, onLeave }: Props) {
  const { t } = useTranslation();
  const [audioOnly, setAudioOnly] = useState(false);

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

  return (
    <LiveKitRoom
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
      onDisconnected={onLeave}
    >
      <View style={styles.wrap}>
        <Text size="lg" weight="bold">
          {t("onlineSession.title")}
        </Text>
        <SessionVideoTiles audioOnly={audioOnly} />
        <SessionCallControls
          bookingId={bookingId}
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