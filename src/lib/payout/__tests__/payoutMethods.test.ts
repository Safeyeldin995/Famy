import { describe, expect, it } from "vitest";
import {
  buildPayoutInsert,
  emptyPayoutDraft,
  instapayConfig,
  normalizeAccountNumber,
  normalizeEgyptMobile,
  normalizeInstapayAddress,
  payoutDestination,
  sortPayoutMethods,
  type PayoutMethodRow,
} from "../payoutMethods";

describe("payout methods", () => {
  it("normalizes Egyptian mobile numbers, including Arabic digits and +20", () => {
    expect(normalizeEgyptMobile("01012345678")).toBe("01012345678");
    expect(normalizeEgyptMobile("+20 101 234 5678")).toBe("01012345678");
    expect(normalizeEgyptMobile("٠١١٢٣٤٥٦٧٨٩")).toBe("01123456789");
    expect(normalizeEgyptMobile("0131234567")).toBeNull();
    expect(normalizeEgyptMobile("0101234567")).toBeNull();
  });

  it("accepts an InstaPay name or linked mobile number", () => {
    expect(normalizeInstapayAddress("Safey@InstaPay")).toBe("safey@instapay");
    expect(normalizeInstapayAddress("safey.qnb")).toBe("safey.qnb@instapay");
    expect(normalizeInstapayAddress("01212345678")).toBe("01212345678");
    expect(normalizeInstapayAddress("@instapay")).toBeNull();
  });

  it("accepts bank account numbers and IBANs", () => {
    expect(normalizeAccountNumber("eg38 0019 0005 0000 0000 2631 8000 2")).toBe(
      "EG380019000500000000263180002",
    );
    expect(normalizeAccountNumber("12-34")).toBeNull();
  });

  it("builds only the fields each method needs", () => {
    const wallet = buildPayoutInsert(
      "p1",
      {
        ...emptyPayoutDraft("vodafone_cash"),
        holderName: " Mona  Ali ",
        walletPhone: "01012345678",
        bankName: "x",
      },
      true,
    );
    expect(wallet).toEqual({
      ok: true,
      row: {
        provider_id: "p1",
        method: "vodafone_cash",
        holder_name: "Mona Ali",
        bank_name: null,
        account_number: null,
        wallet_phone: "01012345678",
        instapay_address: null,
        is_default: true,
      },
    });
    const bank = buildPayoutInsert("p1", { ...emptyPayoutDraft("bank"), holderName: "M" }, false);
    expect(bank).toEqual({ ok: false, errors: ["holderName", "bankName", "accountNumber"] });
  });

  it("shows the value admin copies and puts the default first", () => {
    const base = {
      provider_id: "p",
      holder_name: "M",
      bank_name: null,
      account_number: null,
      wallet_phone: null,
      instapay_address: null,
    };
    const rows: PayoutMethodRow[] = [
      {
        ...base,
        id: "a",
        method: "bank",
        bank_name: "CIB",
        account_number: "123456",
        is_default: false,
        created_at: "2026-01-01",
      },
      {
        ...base,
        id: "b",
        method: "instapay",
        instapay_address: "m@instapay",
        is_default: true,
        created_at: "2026-02-01",
      },
    ];
    expect(sortPayoutMethods(rows).map((r) => r.id)).toEqual(["b", "a"]);
    expect(payoutDestination(rows[0])).toBe("123456");
    expect(payoutDestination(rows[1])).toBe("m@instapay");
  });

  it("reads InstaPay config and ignores non-https links", () => {
    expect(instapayConfig({ handle: "f@instapay", pay_link: "https://ipn.eg/S/x" })).toEqual({
      handle: "f@instapay",
      payLink: "https://ipn.eg/S/x",
      note: "",
    });
    expect(instapayConfig({ pay_link: "javascript:alert(1)" }).payLink).toBe("");
    expect(instapayConfig(null).handle).toBe("");
  });
});
