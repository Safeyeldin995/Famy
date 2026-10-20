import { QueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSessionQueryIsolation } from "../sessionQueryIsolation";

const session = (id: string) => ({ user: { id } }) as Session;

describe("session query isolation", () => {
  it("clears every private cache and remounts observers on direct account switches", () => {
    const qc = new QueryClient();
    const remount = vi.fn();
    const listener = createSessionQueryIsolation(qc, remount);
    listener("INITIAL_SESSION", session("A"));
    for (const key of [
      ["my-profile"],
      ["family-members"],
      ["conversations"],
      ["admin", "payments"],
    ]) {
      qc.setQueryData(key, { owner: "A" });
    }
    listener("SIGNED_IN", session("B"));
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(remount).toHaveBeenCalledTimes(1);
    qc.clear();
  });

  it("records the initial session without clearing or remounting", () => {
    const qc = new QueryClient();
    const remount = vi.fn();
    const listener = createSessionQueryIsolation(qc, remount);
    qc.setQueryData(["my-profile"], { owner: "A" });
    listener("INITIAL_SESSION", session("A"));
    expect(qc.getQueryData(["my-profile"])).toEqual({ owner: "A" });
    expect(remount).not.toHaveBeenCalled();
    qc.clear();
  });

  it("clears on external sign-out and preserves data on same-user token refresh", () => {
    const qc = new QueryClient();
    const listener = createSessionQueryIsolation(qc, vi.fn());
    listener("INITIAL_SESSION", session("A"));
    qc.setQueryData(["family-members"], ["private"]);
    listener("TOKEN_REFRESHED", session("A"));
    listener("SIGNED_IN", session("A"));
    expect(qc.getQueryData(["family-members"])).toEqual(["private"]);
    listener("SIGNED_OUT", null);
    expect(qc.getQueryData(["family-members"])).toBeUndefined();
  });

  it("does not let a late request from A overwrite B's cache", async () => {
    const qc = new QueryClient();
    const listener = createSessionQueryIsolation(qc, vi.fn());
    listener("INITIAL_SESSION", session("A"));
    let resolve!: (value: string) => void;
    const pending = qc.fetchQuery({
      queryKey: ["my-profile"],
      queryFn: () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    });
    const settled = pending.catch(() => undefined);
    listener("SIGNED_IN", session("B"));
    qc.setQueryData(["my-profile"], "B");
    resolve("A");
    await settled;
    expect(qc.getQueryData(["my-profile"])).toBe("B");
    qc.clear();
  });
});
