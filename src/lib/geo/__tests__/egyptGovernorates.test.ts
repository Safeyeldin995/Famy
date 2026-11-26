import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EGYPT_GOVERNORATES,
  governorateName,
  isEgyptGovernorateCode,
  isOnlineOpenFor,
  parseOnlineAvailability,
} from "../egyptGovernorates";

describe("egyptGovernorates", () => {
  it("lists all 27 governorates with unique codes", () => {
    expect(EGYPT_GOVERNORATES).toHaveLength(27);
    expect(new Set(EGYPT_GOVERNORATES.map((g) => g.code)).size).toBe(27);
  });

  it("matches the database list in the migration", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../../../supabase/migrations/20261126100000_online_nationwide_waitlist.sql"),
      "utf8",
    );
    const m = sql.match(/egypt_governorate_codes\(\)[\s\S]*?ARRAY\[([\s\S]*?)\]/);
    expect(m).not.toBeNull();
    const codes = Array.from(m![1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1]);
    expect(codes).toEqual(EGYPT_GOVERNORATES.map((g) => g.code));
  });

  it("names a governorate in the viewer's language", () => {
    expect(governorateName("asyut", "ar")).toBe("أسيوط");
    expect(governorateName("asyut", "en")).toBe("Asyut");
    expect(governorateName("nowhere", "ar")).toBe("");
    expect(governorateName(null, "ar")).toBe("");
    expect(isEgyptGovernorateCode("giza")).toBe(true);
    expect(isEgyptGovernorateCode("Giza")).toBe(false);
  });

  it("parses the online availability setting defensively", () => {
    expect(parseOnlineAvailability(null)).toEqual({ closed_governorates: [] });
    expect(parseOnlineAvailability({ closed_governorates: "x" })).toEqual({
      closed_governorates: [],
    });
    expect(
      parseOnlineAvailability({ closed_governorates: ["sohag", "bad", "aswan", "sohag"] }),
    ).toEqual({ closed_governorates: ["aswan", "sohag"] });
  });

  it("treats an unknown governorate as open", () => {
    const s = { closed_governorates: ["sohag"] };
    expect(isOnlineOpenFor(s, null)).toBe(true);
    expect(isOnlineOpenFor(s, "giza")).toBe(true);
    expect(isOnlineOpenFor(s, "sohag")).toBe(false);
  });
});
