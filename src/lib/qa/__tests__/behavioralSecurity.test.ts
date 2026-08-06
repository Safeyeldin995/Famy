import { describe, expect, it } from "vitest";
import {
  assertDirectInsertDenied,
  assertNoRowReturned,
  assertRowsOwnedByUser,
  isPermissionDeniedError,
  PERMISSION_DENIED_CODE,
  adminCountMatchesBaseline,
} from "@/lib/qa/behavioralSecurity";

describe("behavioralSecurity contracts", () => {
  it("detects PostgreSQL permission denied code", () => {
    expect(isPermissionDeniedError({ code: PERMISSION_DENIED_CODE })).toBe(true);
    expect(isPermissionDeniedError({ code: "23505" })).toBe(false);
    expect(isPermissionDeniedError(null)).toBe(false);
  });

  it("validates row ownership", () => {
    expect(assertRowsOwnedByUser([{ user_id: "a" }, { user_id: "a" }], "a")).toBe(true);
    expect(assertRowsOwnedByUser([{ user_id: "a" }, { user_id: "b" }], "a")).toBe(false);
    expect(assertRowsOwnedByUser([], "a")).toBe(false);
  });

  it("treats null as no row returned", () => {
    expect(assertNoRowReturned(null)).toBe(true);
    expect(assertNoRowReturned({ id: "x" })).toBe(false);
  });

  it("accepts permission denied direct insert with stable row count", () => {
    const verdict = assertDirectInsertDenied({
      error: { code: PERMISSION_DENIED_CODE },
      data: null,
      rowCountBefore: 2,
      rowCountAfter: 2,
    });
    expect(verdict.ok).toBe(true);
  });

  it("rejects validation-style errors masquerading as authorization", () => {
    const verdict = assertDirectInsertDenied({
      error: { code: "23502" },
      data: null,
      rowCountBefore: 2,
      rowCountAfter: 2,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain(PERMISSION_DENIED_CODE);
  });

  it("rejects insert when row count increases", () => {
    const verdict = assertDirectInsertDenied({
      error: { code: PERMISSION_DENIED_CODE },
      data: null,
      rowCountBefore: 2,
      rowCountAfter: 3,
    });
    expect(verdict.ok).toBe(false);
  });

  it("compares admin baseline dynamically", () => {
    expect(adminCountMatchesBaseline(3, 3)).toBe(true);
    expect(adminCountMatchesBaseline(3, 4)).toBe(false);
  });
});
