import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "@/lib/i18n/locales/ar";
import en from "@/lib/i18n/locales/en";
import { WALLET_ENTRY_REASONS } from "@/lib/wallet/walletEntryReasons";

type Dict = Record<string, unknown>;

function pick(dict: Dict, path: string[]): Dict {
  return path.reduce<Dict>((node, key) => (node?.[key] as Dict) ?? {}, dict);
}

const LABEL_BLOCKS = [
  ["wallet", "customer", "reason"],
  ["wallet", "reason"],
  ["onlineWeb", "wallet", "reason"],
];

describe("wallet entry reasons (#525)", () => {
  it("every reason has a label in every wallet list, in Arabic and English", () => {
    for (const locale of [en, ar] as unknown as Dict[]) {
      for (const block of LABEL_BLOCKS) {
        const labels = pick(locale, block);
        for (const reason of WALLET_ENTRY_REASONS) {
          expect(typeof labels[reason], `${block.join(".")}.${reason}`).toBe("string");
          expect(String(labels[reason]).trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("matches the reasons the latest migration allows", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        readFileSync(join(dir, f), "utf8").includes("customer_wallet_entries_reason_check CHECK"),
      )
      .pop();
    expect(latest).toBeTruthy();
    const sql = readFileSync(join(dir, latest!), "utf8");
    const block = sql.slice(sql.lastIndexOf("customer_wallet_entries_reason_check CHECK"));
    const list = block.slice(block.indexOf("("), block.indexOf("));") + 1);
    const allowed = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(allowed).toEqual([...WALLET_ENTRY_REASONS].sort());
  });
});
