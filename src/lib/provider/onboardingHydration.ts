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
  services?: Array<{ service_id?: string | null }>;
  zones?: Array<{ id?: string | null }>;
  references?: Array<{
    full_name?: string | null;
    relationship?: string | null;
    phone?: string | null;
    notes?: string | null;
  }>;
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
  selectedServices: string[];
  selectedZones: string[];
  ref1: OnboardingReferenceForm;
  ref2: OnboardingReferenceForm;
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

  const snapshotServices = Array.isArray(snapshot.services) ? snapshot.services : [];
  const snapshotZones = Array.isArray(snapshot.zones) ? snapshot.zones : [];
  const snapshotRefs = Array.isArray(snapshot.references) ? snapshot.references : [];

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
    selectedServices: snapshotServices
      .map((s) => s.service_id)
      .filter((id): id is string => Boolean(id)),
    selectedZones: snapshotZones.map((z) => z.id).filter((id): id is string => Boolean(id)),
    ref1: snapshotRefs[0]
      ? {
          full_name: snapshotRefs[0].full_name ?? "",
          relationship: snapshotRefs[0].relationship ?? "",
          phone: snapshotRefs[0].phone ?? "",
          notes: snapshotRefs[0].notes ?? "",
        }
      : EMPTY_REF,
    ref2: snapshotRefs[1]
      ? {
          full_name: snapshotRefs[1].full_name ?? "",
          relationship: snapshotRefs[1].relationship ?? "",
          phone: snapshotRefs[1].phone ?? "",
          notes: snapshotRefs[1].notes ?? "",
        }
      : EMPTY_REF,
  };
}
