import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  registerGlobals,
  useTracks,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import { useTranslation } from "react-i18next";
import { Text } from "./Text";
import { colors, space } from "./theme";

let registered = false;

function SessionVideoTiles() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  if (tracks.length === 0) {
    return (
      <View style={styles.centered}>
        <Text tone="muted">{/* shown while cameras connect */}</Text>
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

type Props = {
  token: string;
  serverUrl: string;
  onLeave: () => void;
};

export function OnlineSessionRoom({ token, serverUrl, onLeave }: Props) {
  const { t } = useTranslation();

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
      video
      onDisconnected={onLeave}
    >
      <View style={styles.wrap}>
        <Text size="lg" weight="bold">
          {t("onlineSession.title")}
        </Text>
        <SessionVideoTiles />
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
});