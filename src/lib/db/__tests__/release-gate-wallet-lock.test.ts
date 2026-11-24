import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WALLET_MIGRATION = "20261115130000_provider_wallet_payout.sql";

describe("release gate: provider wallet lock order", () => {
  it("uses the same advisory lock namespace for payout and debt payment", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations", WALLET_MIGRATION),
      "utf8",
    );
    const lockPattern = /famy_provider_wallet:/g;
    const hits = sql.match(lockPattern) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(sql.indexOf("admin_record_provider_payout")).toBeLessThan(
      sql.indexOf("admin_record_provider_debt_payment"),
    );
  });
});