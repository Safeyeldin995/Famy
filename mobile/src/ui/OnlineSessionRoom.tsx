import { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  registerGlobals,
  useTracks,
  useLocalParticipant,
  useRoomContext,
} from "@livekit/react-native";
import { Track, ConnectionState } from "livekit-client";
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
        <Text>{/* audio-only session */}</Text>
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

function SessionControls({
  audioOnly,
  bookingId,
  party,
  onLeave,
}: {
  audioOnly: boolean;
  bookingId: string;
  party: "customer" | "provider";
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(audioOnly);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const onState = (state: ConnectionState) => setReconnecting(state === ConnectionState.Reconnecting);
    room.on("connectionStateChanged", onState);
    return () => {
      room.off("connectionStateChanged", onState);
    };
  }, [room]);

  const toggleMute = async () => {
    const next = !muted;
    await localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  };

  const toggleCamera = async () => {
    const next = !cameraOff;
    await localParticipant.setCameraEnabled(!next);
    setCameraOff(next);
  };

  const reportAndLeave = async () => {
    await reportOnlineSessionAndLeave({
      bookingId,
      description: t("onlineSession.reportDefaultBody"),
    });
    room.disconnect(true);
    onLeave();
  };

  return (
    <View style={styles.controls}>
      {reconnecting ? <Text size="sm">{t("onlineSession.reconnecting")}</Text> : null}
      <View style={styles.controlRow}>
        <Button
          variant="secondary"
          label={muted ? t("onlineSession.unmute") : t("onlineSession.mute")}
          onPress={toggleMute}
        />
        {!audioOnly ? (
          <Button
            variant="secondary"
            label={cameraOff ? t("onlineSession.cameraOn") : t("onlineSession.cameraOff")}
            onPress={toggleCamera}
          />
        ) : null}
        {party === "provider" ? (
          <Button
            variant="secondary"
            label={t("onlineSession.screenShare")}
            onPress={() => localParticipant.setScreenShareEnabled(true)}
          />
        ) : null}
      </View>
      <Button label={t("onlineSession.reportAndLeave")} onPress={reportAndLeave} />
      <Button variant="secondary" label={t("onlineSession.leave")} onPress={() => room.disconnect(true)} />
    </View>
  );
}

function SessionRoomInner({
  audioOnly,
  bookingId,
  party,
  onLeave,
}: {
  audioOnly: boolean;
  bookingId: string;
  party: "customer" | "provider";
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      <Text size="lg" weight="bold">
        {t("onlineSession.title")}
      </Text>
      <SessionVideoTiles audioOnly={audioOnly} />
      <SessionControls audioOnly={audioOnly} bookingId={bookingId} party={party} onLeave={onLeave} />
    </View>
  );
}

type Props = {
  token: string;
  serverUrl: string;
  bookingId: string;
  party: "customer" | "provider";
  audioOnly?: boolean;
  onLeave: () => void;
};

export function OnlineSessionRoom({
  token,
  serverUrl,
  bookingId,
  party,
  audioOnly = false,
  onLeave,
}: Props) {
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
      onDisconnected={onLeave}
      options={{ adaptiveStream: true, dynacast: true }}
    >
      <SessionRoomInner
        audioOnly={audioOnly}
        bookingId={bookingId}
        party={party}
        onLeave={onLeave}
      />
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
  controlRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});