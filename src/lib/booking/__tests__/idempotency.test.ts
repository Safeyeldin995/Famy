import { describe, expect, it } from "vitest";
import {
  bookingSubmissionFingerprint,
  normalizeRequirementSelections,
  resolveIdempotencyKey,
  type IdempotencyKeyState,
} from "@/lib/booking/idempotency";

const basePayload = {
  provider_id: "11111111-1111-1111-1111-111111111111",
  service_id: "22222222-2222-2222-2222-222222222222",
  address_id: "33333333-3333-3333-3333-333333333333",
  start_at: "2026-08-01T10:00:00.000Z",
  end_at: "2026-08-01T12:00:00.000Z",
  family_member_id: null as string | null,
  promo_code_id: null as string | null,
  notes: null as string | null,
  requirement_selections: [
    { requirement_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", chosen_by: "customer" as const },
    { requirement_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", chosen_by: "provider" as const },
  ],
};

describe("booking idempotency fingerprint", () => {
  it("produces the same fingerprint for semantically identical payloads", () => {
    const first = bookingSubmissionFingerprint(basePayload);
    const second = bookingSubmissionFingerprint({ ...basePayload, notes: "  " });
    expect(first).toBe(second);
  });

  it("ignores requirement ordering", () => {
    const ordered = bookingSubmissionFingerprint(basePayload);
    const reordered = bookingSubmissionFingerprint({
      ...basePayload,
      requirement_selections: [...basePayload.requirement_selections!].reverse(),
    });
    expect(ordered).toBe(reordered);
  });

  it("changes fingerprint when a material field changes", () => {
    const original = bookingSubmissionFingerprint(basePayload);
    const changedSlot = bookingSubmissionFingerprint({
      ...basePayload,
      end_at: "2026-08-01T14:00:00.000Z",
    });
    expect(changedSlot).not.toBe(original);
  });

  it("changes fingerprint when a requirement value changes", () => {
    const original = bookingSubmissionFingerprint(basePayload);
    const changedRequirement = bookingSubmissionFingerprint({
      ...basePayload,
      requirement_selections: normalizeRequirementSelections([
        { requirement_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", chosen_by: "provider" },
        { requirement_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", chosen_by: "provider" },
      ]),
    });
    expect(changedRequirement).not.toBe(original);
  });

  it("reuses the idempotency key while fingerprint is unchanged", () => {
    const fingerprint = bookingSubmissionFingerprint(basePayload);
    const state: IdempotencyKeyState = { key: "key-a", fingerprint };
    expect(resolveIdempotencyKey(state, fingerprint, () => "key-b")).toEqual(state);
  });

  it("issues a new idempotency key when fingerprint changes", () => {
    const previous: IdempotencyKeyState = {
      key: "key-a",
      fingerprint: bookingSubmissionFingerprint(basePayload),
    };
    const nextFingerprint = bookingSubmissionFingerprint({
      ...basePayload,
      start_at: "2026-08-01T11:00:00.000Z",
    });
    expect(resolveIdempotencyKey(previous, nextFingerprint, () => "key-b")).toEqual({
      key: "key-b",
      fingerprint: nextFingerprint,
    });
  });
});
