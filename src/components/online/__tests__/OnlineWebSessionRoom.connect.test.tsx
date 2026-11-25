// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnlineWebSessionRoom } from "../OnlineWebSessionRoom";

const fetchToken = vi.fn();
const roomConnect = vi.fn().mockResolvedValue(undefined);
const roomInstances: Array<{ on: ReturnType<typeof vi.fn>; connect: typeof roomConnect }> = [];

vi.mock("@/lib/online/onlineSessionApi", () => ({
  fetchOnlineSessionToken: (...args: unknown[]) => fetchToken(...args),
}));

vi.mock("livekit-client", () => {
  class MockRoom {
    remoteParticipants = new Map();
    localParticipant = {
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
      setCameraEnabled: vi.fn().mockResolvedValue(undefined),
      getTrackPublication: () => null,
    };
    on = vi.fn();
    off = vi.fn();
    removeAllListeners = vi.fn();
    disconnect = vi.fn();
    connect = roomConnect;
    constructor() {
      roomInstances.push(this as never);
    }
  }
  return {
    ConnectionState: { Disconnected: "disconnected", Reconnecting: "reconnecting" },
    Room: MockRoom,
    RoomEvent: {
      TrackSubscribed: "TrackSubscribed",
      TrackUnsubscribed: "TrackUnsubscribed",
      ParticipantConnected: "ParticipantConnected",
      ParticipantDisconnected: "ParticipantDisconnected",
      ConnectionStateChanged: "ConnectionStateChanged",
    },
    Track: { Kind: { Video: "video", Audio: "audio" }, Source: { Camera: "camera" } },
  };
});

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: "en" },
    }),
  };
});

describe("OnlineWebSessionRoom", () => {
  beforeEach(() => {
    fetchToken.mockReset();
    roomConnect.mockClear();
    roomInstances.length = 0;
    fetchToken.mockResolvedValue({ ok: true, url: "wss://lk", token: "tok" });

    Object.defineProperty(global.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
  });

  it("requests a session token after Continue once the room layout is mounted", async () => {
    const user = userEvent.setup();
    const start = new Date("2030-06-01T12:00:00Z");
    const end = new Date("2030-06-01T13:00:00Z");

    render(
      <OnlineWebSessionRoom bookingId="b1" startAt={start} endAt={end} onLeave={() => {}} />,
    );

    await user.click(screen.getByRole("button", { name: "onlineSession.preJoinContinue" }));

    await waitFor(() => expect(fetchToken).toHaveBeenCalledWith({ bookingId: "b1", displayName: undefined }));
    await waitFor(() => expect(roomConnect).toHaveBeenCalled());
  });
});