import { describe, expect, it } from "vitest";
import { ugcReportErrorKey } from "../ugcReportErrors";

describe("ugcReportErrorKey (#523)", () => {
  it("maps the server refusals to clear messages", () => {
    expect(ugcReportErrorKey({ message: "UGC_REPORT_OWN_MESSAGE: You cannot report your own message." })).toBe(
      "ugc.errors.ownMessage",
    );
    expect(ugcReportErrorKey(new Error("UGC_REPORT_LIMIT: Too many reports today."))).toBe("ugc.errors.limit");
    expect(ugcReportErrorKey(new Error("network down"))).toBe("ugc.errors.generic");
    expect(ugcReportErrorKey(null)).toBe("ugc.errors.generic");
  });
});
