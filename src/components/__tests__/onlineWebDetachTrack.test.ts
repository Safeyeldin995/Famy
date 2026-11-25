// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("livekit-client", () => ({
  Room: class {},
  RoomEvent: {},
  Track: { Kind: { Video: "video", Audio: "audio" }, Source: { Camera: "camera" } },
}));
vi.mock("@/lib/online/onlineSessionApi", () => ({ fetchOnlineSessionToken: vi.fn() }));

import { detachTrackElements } from "../online/OnlineWebSessionRoom";

describe("detachTrackElements", () => {
  it("clears but keeps the React-owned local preview", () => {
    const host = document.createElement("div");
    const local = document.createElement("video");
    host.appendChild(local);
    detachTrackElements({ detach: () => [local] }, local);
    expect(local.isConnected || host.contains(local)).toBe(true);
    expect(local.srcObject).toBeNull();
  });

  it("removes remote elements and their tile", () => {
    const host = document.createElement("div");
    const tile = document.createElement("div");
    tile.setAttribute("data-lk-remote-tile", "1");
    const remote = document.createElement("video");
    tile.appendChild(remote);
    host.appendChild(tile);
    detachTrackElements({ detach: () => [remote] }, null);
    expect(host.contains(remote)).toBe(false);
    expect(host.contains(tile)).toBe(false);
  });
});
