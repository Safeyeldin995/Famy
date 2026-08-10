import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  mergeRegistryState,
  readRegistry,
  registerUserEntry,
  removeRegistryUsers,
  withRegistryLock,
} from "../registry.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";

describe("canonical qa registry concurrency", () => {
  useIsolatedRegistry();

  it("merge-safe journal retains every registered user id", () => {
    for (let i = 0; i < 25; i++) {
      registerUserEntry({ userId: `user-${i}`, email: `qa-user-${i}@famio.local`, suite: "test" });
    }
    const merged = mergeRegistryState();
    expect(merged.users).toHaveLength(25);
    expect(new Set(merged.users.map((u) => u.userId)).size).toBe(25);
  });

  it("serialized lock prevents lost updates under interleaved writers", () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      withRegistryLock(() => {
        registerUserEntry({ userId: `locked-${i}`, email: `qa-locked-${i}@famio.local` });
        ids.push(`locked-${i}`);
      });
    }
    const merged = mergeRegistryState();
    expect(merged.users).toHaveLength(20);
    expect(new Set(merged.users.map((u) => u.userId)).size).toBe(20);
  });

  it("remove-user journal entries compact into merged state", () => {
    registerUserEntry({ userId: "keep-1", email: "qa-keep-1@famio.local" });
    registerUserEntry({ userId: "drop-1", email: "qa-drop-1@famio.local" });
    registerUserEntry({ userId: "keep-2", email: "qa-keep-2@famio.local" });
    removeRegistryUsers(["drop-1"]);
    const merged = mergeRegistryState();
    expect(merged.users.map((u) => u.userId).sort()).toEqual(["keep-1", "keep-2"]);
    expect(readRegistry().users.map((u) => u.userId).sort()).toEqual(["keep-1", "keep-2"]);
  });
});
