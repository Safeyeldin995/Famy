export type OnboardingReferenceForm = {
  full_name: string;
  relationship: string;
  phone: string;
  notes: string;
};

export type OnboardingSnapshotData = {
  exists?: boolean;
  profile?: {
    full_name?: string | null;
    phone?: string | null;
    avatar_url?: string | null;
  };
  provider?: {
    bio_en?: string | null;
    bio_ar?: string | null;
    years_experience?: number | null;
    languages?: string[] | null;
    city?: string | null;
  };
  details?: {
    date_of_birth?: string | null;
    gender?: string | null;
    governorate?: string | null;
    area?: string | null;
    full_address?: string | null;
    previous_work?: string | null;
    child_age_groups?: string[] | null;
    newborn_experience?: boolean | null;
    first_aid_training?: boolean | null;
    accuracy_confirmed_at?: string | null;
  } | null;
};

export type OnboardingFormHydration = {
  legalName: string;
  dob: string;
  gender: string;
  governorate: string;
  area: string;
  address: string;
  years: number;
  bioEn: string;
  bioAr: string;
  previousWork: string;
  langs: string[];
  childGroups: string[];
  newborn: boolean;
  firstAid: boolean;
  confirmed: boolean;
  avatarPath: string | null;
};

export type SavedSelectionLoadState = "loading" | "error" | "ready";

export type SavedServiceRow = { service_id?: string | null };
export type SavedZoneRow = { zone_id?: string | null };
export type SavedReferenceRow = {
  full_name?: string | null;
  relationship?: string | null;
  phone?: string | null;
  notes?: string | null;
  sort_order?: number | null;
};

const EMPTY_REF: OnboardingReferenceForm = {
  full_name: "",
  relationship: "",
  phone: "",
  notes: "",
};

/** Map provider_onboarding_snapshot RPC data into onboarding form state. */
export function mapSnapshotToOnboardingFormState(
  snapshot: OnboardingSnapshotData,
): OnboardingFormHydration {
  const profile = snapshot.profile ?? {};
  const details = snapshot.details ?? {};
  const snapshotProvider = snapshot.provider ?? {};

  return {
    legalName: profile.full_name ?? "",
    dob: details.date_of_birth ?? "",
    gender: details.gender ?? "",
    governorate: details.governorate ?? "",
    area: details.area ?? snapshotProvider.city ?? "",
    address: details.full_address ?? "",
    years: snapshotProvider.years_experience ?? 1,
    bioEn: snapshotProvider.bio_en ?? "",
    bioAr: snapshotProvider.bio_ar ?? "",
    previousWork: details.previous_work ?? "",
    langs: snapshotProvider.languages ?? ["arabic"],
    childGroups: details.child_age_groups ?? [],
    newborn: !!details.newborn_experience,
    firstAid: !!details.first_aid_training,
    confirmed: !!details.accuracy_confirmed_at,
    avatarPath: profile.avatar_url ?? null,
  };
}

export function savedSelectionLoadState(query: {
  isSuccess: boolean;
  isError: boolean;
}): SavedSelectionLoadState {
  if (query.isError) return "error";
  if (query.isSuccess) return "ready";
  return "loading";
}

export function mapSavedServiceIds(rows: SavedServiceRow[] | null | undefined): string[] {
  return [
    ...new Set((rows ?? []).map((row) => row.service_id).filter((id): id is string => Boolean(id))),
  ];
}

export function mapSavedZoneIds(rows: SavedZoneRow[] | null | undefined): string[] {
  return [
    ...new Set((rows ?? []).map((row) => row.zone_id).filter((id): id is string => Boolean(id))),
  ];
}

function toReferenceForm(row?: SavedReferenceRow | null): OnboardingReferenceForm {
  if (!row) return { ...EMPTY_REF };
  return {
    full_name: row.full_name ?? "",
    relationship: row.relationship ?? "",
    phone: row.phone ?? "",
    notes: row.notes ?? "",
  };
}

export function mapSavedReferences(rows: SavedReferenceRow[] | null | undefined): {
  ref1: OnboardingReferenceForm;
  ref2: OnboardingReferenceForm;
} {
  const sorted = [...(rows ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return {
    ref1: toReferenceForm(sorted[0]),
    ref2: toReferenceForm(sorted[1]),
  };
}

export function buildCoverageSavePayload(
  loadState: SavedSelectionLoadState,
  selectedZoneIds: string[],
  activeZoneIds: string[],
):
  | { ok: true; zone_ids: string[] }
  | { ok: false; error: "not_loaded" | "load_failed" | "zone_required" } {
  if (loadState === "loading") return { ok: false, error: "not_loaded" };
  if (loadState === "error") return { ok: false, error: "load_failed" };
  const zone_ids = selectedZoneIds.filter((id) => activeZoneIds.includes(id));
  if (zone_ids.length === 0) return { ok: false, error: "zone_required" };
  return { ok: true, zone_ids };
}

export function buildServicesSavePayload(
  loadState: SavedSelectionLoadState,
  selectedServiceIds: string[],
  savedServiceIds: string[],
  offeredServiceIds: string[],
): { ok: true; service_ids: string[] } | { ok: false; error: "not_loaded" | "load_failed" } {
  if (loadState === "loading") return { ok: false, error: "not_loaded" };
  if (loadState === "error") return { ok: false, error: "load_failed" };
  const saved = new Set(savedServiceIds);
  const offered = new Set(offeredServiceIds);
  return {
    ok: true,
    service_ids: selectedServiceIds.filter((id) => !saved.has(id) && offered.has(id)),
  };
}
