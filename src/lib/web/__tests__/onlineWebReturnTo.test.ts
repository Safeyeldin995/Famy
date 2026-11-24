import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  consumeOnlineWebReturnTo,
  peekOnlineWebReturnTo,
  stashOnlineWebReturnTo,
} from "../onlineWebReturnTo";

describe("onlineWebReturnTo", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    const sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear(),
    };
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("window", { sessionStorage } as Window & typeof globalThis);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stashes and consumes a return path", () => {
    stashOnlineWebReturnTo("/online/tutors/x/request");
    expect(peekOnlineWebReturnTo()).toBe("/online/tutors/x/request");
    expect(consumeOnlineWebReturnTo()).toBe("/online/tutors/x/request");
    expect(peekOnlineWebReturnTo()).toBeNull();
  });
});