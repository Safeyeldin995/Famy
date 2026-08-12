import { describe, expect, it } from "vitest";
import { resolveChatViewerUserId } from "../messaging";

describe("resolveChatViewerUserId", () => {
  it("returns the local session user id when the viewer is still mounted", async () => {
    const userId = await resolveChatViewerUserId(
      async () => ({
        data: { session: { user: { id: "user-123" } } },
        error: null,
      }),
      () => true,
    );

    expect(userId).toBe("user-123");
  });

  it("returns null when the local session has no authenticated user", async () => {
    const userId = await resolveChatViewerUserId(
      async () => ({
        data: { session: null },
        error: null,
      }),
      () => true,
    );

    expect(userId).toBeNull();
  });

  it("returns undefined after navigation teardown so callers skip state updates", async () => {
    let active = true;
    const userId = await resolveChatViewerUserId(
      async () => {
        active = false;
        throw new TypeError("Failed to fetch");
      },
      () => active,
    );

    expect(userId).toBeUndefined();
  });

  it("surfaces genuine session read failures while the viewer remains mounted", async () => {
    await expect(
      resolveChatViewerUserId(
        async () => ({
          data: { session: null },
          error: new Error("session read failed"),
        }),
        () => true,
      ),
    ).rejects.toThrow("session read failed");
  });
});
