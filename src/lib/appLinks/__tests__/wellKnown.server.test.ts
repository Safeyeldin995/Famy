import { describe, expect, it } from "vitest";
import { appleAppSiteAssociation, assetLinksDocument } from "../wellKnown.server";

describe("wellKnown app links", () => {
  it("omits Android fingerprints when env is unset", () => {
    expect(JSON.parse(assetLinksDocument({}))).toEqual([]);
  });

  it("includes configured Android fingerprint", () => {
    const doc = JSON.parse(
      assetLinksDocument({ ANDROID_APP_LINK_SHA256: "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99" }),
    );
    expect(doc[0]?.target?.sha256_cert_fingerprints?.[0]).toContain("AA:BB");
  });

  it("omits Apple app entries when team id is unset", () => {
    expect(JSON.parse(appleAppSiteAssociation({})).applinks.details).toEqual([]);
  });

  it("builds apple-app-site-association paths", () => {
    const doc = JSON.parse(appleAppSiteAssociation({ APPLE_APP_LINK_TEAM_ID: "ABCDE12345" }));
    expect(doc.applinks.details[0].appID).toBe("ABCDE12345.com.famy.app");
    expect(doc.applinks.details[0].paths).toContain("/online/lessons/*");
  });
});