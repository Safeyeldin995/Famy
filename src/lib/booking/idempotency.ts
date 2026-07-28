export type BookingRequirementSelection = {
  requirement_id: string;
  chosen_by: string;
};

export type BookingSubmissionPayload = {
  provider_id: string;
  service_id: string;
  address_id: string;
  start_at: string;
  end_at: string;
  family_member_id?: string | null;
  promo_code_id?: string | null;
  notes?: string | null;
  requirement_selections?: BookingRequirementSelection[] | null;
};

export type IdempotencyKeyState = {
  key: string;
  fingerprint: string;
};

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeRequirementSelections(
  selections: BookingRequirementSelection[] | null | undefined,
): BookingRequirementSelection[] {
  return [...(selections ?? [])]
    .map((selection) => ({
      requirement_id: selection.requirement_id,
      chosen_by: selection.chosen_by,
    }))
    .sort((a, b) => a.requirement_id.localeCompare(b.requirement_id));
}

export function bookingSubmissionFingerprint(payload: BookingSubmissionPayload): string {
  const normalized = {
    provider_id: payload.provider_id,
    service_id: payload.service_id,
    address_id: payload.address_id,
    start_at: payload.start_at,
    end_at: payload.end_at,
    family_member_id: payload.family_member_id ?? null,
    promo_code_id: payload.promo_code_id ?? null,
    notes: normalizeOptionalText(payload.notes),
    requirement_selections: normalizeRequirementSelections(payload.requirement_selections),
  };
  return JSON.stringify(normalized);
}

export function resolveIdempotencyKey(
  state: IdempotencyKeyState | null,
  fingerprint: string,
  createKey: () => string = () => crypto.randomUUID(),
): IdempotencyKeyState {
  if (state?.fingerprint === fingerprint) {
    return state;
  }
  return { key: createKey(), fingerprint };
}
