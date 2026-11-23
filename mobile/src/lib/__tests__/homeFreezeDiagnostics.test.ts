import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  bumpHomeFocusEffect,
  bumpHomeQueryFetch,
  homeFreezeDiagEnabled,
  readHomeFreezeDiagnostics,
  resetHomeFreezeDiagnostics,
} from "../homeFreezeDiagnostics";

describe("homeFreezeDiagnostics", () => {
  const prev = process.env.EXPO_PUBLIC_HOME_FREEZE_DIAG;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_HOME_FREEZE_DIAG = "1";
    resetHomeFreezeDiagnostics();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_HOME_FREEZE_DIAG;
    else process.env.EXPO_PUBLIC_HOME_FREEZE_DIAG = prev;
  });

  it("counts focus effect and query fetch starts", () => {
    expect(homeFreezeDiagEnabled()).toBe(true);
    bumpHomeFocusEffect();
    bumpHomeQueryFetch("bookings");
    const snap = readHomeFreezeDiagnostics();
    expect(snap.focusEffectRuns).toBe(1);
    expect(snap.queryFetchStarts.bookings).toBe(1);
  });
});