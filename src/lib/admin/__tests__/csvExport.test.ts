import { describe, expect, it } from "vitest";
import { csvBody, escapeCsvCell, neutralizeCsvCell } from "../csvExport";

describe("csvExport formula injection neutralization", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["=CMD|' /C calc'!A0", "'=CMD|' /C calc'!A0"],
    ["+2+3", "'+2+3"],
    ["-1+1", "'-1+1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\t=1+1", "'\t=1+1"],
    ["\r=1+1", "'\r=1+1"],
  ])("neutralizes %j", (input, expected) => {
    expect(neutralizeCsvCell(input)).toBe(expected);
  });

  it("leaves ordinary text and numbers unchanged", () => {
    expect(neutralizeCsvCell("hello")).toBe("hello");
    expect(neutralizeCsvCell("42")).toBe("42");
    expect(neutralizeCsvCell("Safeyeldin")).toBe("Safeyeldin");
    expect(neutralizeCsvCell("")).toBe("");
  });

  it("quotes neutralized formula cells so Excel keeps them as text", () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(escapeCsvCell("+cmd")).toBe(`"'+cmd"`);
  });

  it("still quotes commas, quotes, and newlines", () => {
    expect(escapeCsvCell('hello, "world"')).toBe(`"hello, ""world"""`);
    expect(escapeCsvCell("line\nbreak")).toBe(`"line\nbreak"`);
  });

  it("builds a formula-safe CSV body", () => {
    const body = csvBody([
      ["name", "amount"],
      ["=cmd", "10"],
      ["Mona", "-5+1"],
    ]);
    expect(body).toBe(`name,amount\r\n"'=cmd",10\r\nMona,"'-5+1"`);
  });
});
