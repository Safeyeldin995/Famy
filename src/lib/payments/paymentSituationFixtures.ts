/** Shared inputs for TS paymentSituation and SQL admin_payment_situation contract tests. */
export const paymentSituationFixtures = [
  {
    name: "refundDue cancelled captured online",
    sql: ["captured", "online", "paymob", null, "cancelled", false],
    ts: {
      status: "captured",
      payment_method_type: "online",
      method: "paymob",
      proof_path: null,
      booking: { status: "cancelled" },
      hasCashLedger: false,
    },
    expect: "refundDue",
  },
  {
    name: "awaitingProof transfer without receipt",
    sql: ["pending_review", "manual_transfer", "instapay", null, "completed", false],
    ts: {
      status: "pending_review",
      payment_method_type: "manual_transfer",
      method: "instapay",
      proof_path: null,
      booking: { status: "completed" },
      hasCashLedger: false,
    },
    expect: "awaitingProof",
  },
  {
    name: "awaitingProof blank proof path",
    sql: ["pending_review", "manual_transfer", "instapay", "   ", "completed", false],
    ts: {
      status: "pending_review",
      payment_method_type: "manual_transfer",
      method: "instapay",
      proof_path: "   ",
      booking: { status: "completed" },
      hasCashLedger: false,
    },
    expect: "awaitingProof",
  },
  {
    name: "review transfer with receipt",
    sql: ["pending_review", "manual_transfer", "instapay", "proof.jpg", "completed", false],
    ts: {
      status: "pending_review",
      payment_method_type: "manual_transfer",
      method: "instapay",
      proof_path: "proof.jpg",
      booking: { status: "completed" },
      hasCashLedger: false,
    },
    expect: "review",
  },
  {
    name: "cashUnconfirmed completed cash",
    sql: ["pending", "cash", "cash", null, "completed", false],
    ts: {
      status: "pending",
      payment_method_type: "cash",
      method: "cash",
      proof_path: null,
      booking: { status: "completed" },
      hasCashLedger: false,
    },
    expect: "cashUnconfirmed",
  },
] as const;