import {
  ControlBar,
  LiveKitRoom,
  RoomAudioRenderer,
  VideoConference,
} from "@livekit/components-react";
import "@livekit/components-styles";
type Props = {
  token: string;
  serverUrl: string;
  onLeave: () => void;
};

export function OnlineSessionRoom({ token, serverUrl, onLeave }: Props) {
  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      audio
      video
      onDisconnected={onLeave}
      data-lk-theme="default"
    >
      <VideoConference />
      <RoomAudioRenderer />
      <ControlBar controls={{ chat: true, screenShare: true }} />
    </LiveKitRoom>
  );
}