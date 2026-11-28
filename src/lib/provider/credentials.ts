/**
 * Provider credentials (PO, 28 Nov): education, work experience and certificates.
 * Shared by the website and the mobile app (imported there as @shared/provider/credentials).
 * Every call takes the platform's Supabase client so this file stays client-agnostic.
 * Tables and RPCs come from migration 20261128150500_provider_credentials.sql.
 */

export type EducationRow = {
  id: string;
  provider_id: string;
  institution: string;
  degree: string;
  field_of_study: string | null;
  start_year: number | null;
  end_year: number | null;
  proof_path: string | null;
};

export type ExperienceRow = {
  id: string;
  provider_id: string;
  role_title: string;
  place: string;
  start_year: number | null;
  end_year: number | null;
  is_current: boolean;
  description: string | null;
};

export type CertificateStatus = "pending" | "verified" | "rejected";

export type CertificateRow = {
  id: string;
  provider_id: string;
  title: string;
  issuer: string;
  issued_year: number | null;
  file_path: string;
  status: CertificateStatus;
  review_note: string | null;
  reviewed_at: string | null;
};

export type ProviderCredentials = {
  education: EducationRow[];
  experience: ExperienceRow[];
  certificates: CertificateRow[];
};

export type PublicCredentials = {
  education: Pick<
    EducationRow,
    "id" | "institution" | "degree" | "field_of_study" | "start_year" | "end_year"
  >[];
  experience: Pick<
    ExperienceRow,
    "id" | "role_title" | "place" | "start_year" | "end_year" | "is_current" | "description"
  >[];
  certificates: { id: string; title: string; issuer: string; issued_year: number | null }[];
};

export type CredentialKind = "education" | "experience" | "certificates";
export const credentialItems: readonly CredentialKind[] = [
  "education",
  "experience",
  "certificates",
];

export const CREDENTIALS_BUCKET = "provider-credentials";
export const CREDENTIAL_MAX_ROWS = 15;
export const CREDENTIAL_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const CREDENTIAL_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;

export const credentialKeys = {
  mine: (providerId: string | undefined) => ["provider-credentials", providerId] as const,
  public: (providerId: string | undefined) => ["public-provider-credentials", providerId] as const,
  admin: (providerId: string | undefined) => ["admin-provider-credentials", providerId] as const,
};

// The generated Database types don't include these tables yet, so calls go through a loose client.
type Loose = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storage: { from: (bucket: string) => any };
};
const loose = (client: unknown) => client as Loose;

const thisYear = () => new Date().getFullYear();

export function yearOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n =
    typeof value === "number"
      ? value
      : Number(
          String(value)
            .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
            .trim(),
        );
  return Number.isInteger(n) ? n : null;
}

export type CredentialFieldError =
  "required" | "tooShort" | "tooLong" | "year" | "yearOrder" | "file";

function textError(
  value: string | null | undefined,
  opts: { required?: boolean; max?: number } = {},
) {
  const v = (value ?? "").trim();
  if (!v) return opts.required ? ("required" as const) : null;
  if (opts.required && v.length < 2) return "tooShort" as const;
  if (v.length > (opts.max ?? 160)) return "tooLong" as const;
  return null;
}

function yearError(year: number | null) {
  if (year === null) return null;
  return year >= 1950 && year <= thisYear() + 6 ? null : ("year" as const);
}

export type EducationDraft = {
  institution: string;
  degree: string;
  field_of_study: string;
  start_year: string;
  end_year: string;
};

export function validateEducation(d: EducationDraft) {
  const start = yearOrNull(d.start_year);
  const end = yearOrNull(d.end_year);
  const errors: Partial<Record<keyof EducationDraft, CredentialFieldError>> = {};
  const institution = textError(d.institution, { required: true });
  const degree = textError(d.degree, { required: true });
  const field = textError(d.field_of_study);
  if (institution) errors.institution = institution;
  if (degree) errors.degree = degree;
  if (field) errors.field_of_study = field;
  if (d.start_year.trim() && start === null) errors.start_year = "year";
  else if (yearError(start)) errors.start_year = "year";
  if (d.end_year.trim() && end === null) errors.end_year = "year";
  else if (yearError(end)) errors.end_year = "year";
  else if (start !== null && end !== null && end < start) errors.end_year = "yearOrder";
  return errors;
}

export type ExperienceDraft = {
  role_title: string;
  place: string;
  start_year: string;
  end_year: string;
  is_current: boolean;
  description: string;
};

export function validateExperience(d: ExperienceDraft) {
  const start = yearOrNull(d.start_year);
  const end = d.is_current ? null : yearOrNull(d.end_year);
  const errors: Partial<Record<keyof ExperienceDraft, CredentialFieldError>> = {};
  const role = textError(d.role_title, { required: true });
  const place = textError(d.place, { required: true });
  const description = textError(d.description, { max: 1000 });
  if (role) errors.role_title = role;
  if (place) errors.place = place;
  if (description) errors.description = description;
  if (d.start_year.trim() && start === null) errors.start_year = "year";
  else if (yearError(start)) errors.start_year = "year";
  if (!d.is_current) {
    if (d.end_year.trim() && end === null) errors.end_year = "year";
    else if (yearError(end)) errors.end_year = "year";
    else if (start !== null && end !== null && end < start) errors.end_year = "yearOrder";
  }
  return errors;
}

export type CertificateDraft = {
  title: string;
  issuer: string;
  issued_year: string;
  hasFile: boolean;
};

export function validateCertificate(d: CertificateDraft) {
  const year = yearOrNull(d.issued_year);
  const errors: Partial<Record<keyof CertificateDraft, CredentialFieldError>> = {};
  const title = textError(d.title, { required: true });
  const issuer = textError(d.issuer, { required: true });
  if (title) errors.title = title;
  if (issuer) errors.issuer = issuer;
  if (d.issued_year.trim() && year === null) errors.issued_year = "year";
  else if (yearError(year)) errors.issued_year = "year";
  if (!d.hasFile) errors.hasFile = "file";
  return errors;
}

export function educationPayload(d: EducationDraft) {
  return {
    institution: d.institution.trim(),
    degree: d.degree.trim(),
    field_of_study: d.field_of_study.trim() || null,
    start_year: yearOrNull(d.start_year),
    end_year: yearOrNull(d.end_year),
  };
}

export function experiencePayload(d: ExperienceDraft) {
  return {
    role_title: d.role_title.trim(),
    place: d.place.trim(),
    start_year: yearOrNull(d.start_year),
    end_year: d.is_current ? null : yearOrNull(d.end_year),
    is_current: d.is_current,
    description: d.description.trim() || null,
  };
}

export function emptyEducationDraft(row?: EducationRow | null): EducationDraft {
  return {
    institution: row?.institution ?? "",
    degree: row?.degree ?? "",
    field_of_study: row?.field_of_study ?? "",
    start_year: row?.start_year != null ? String(row.start_year) : "",
    end_year: row?.end_year != null ? String(row.end_year) : "",
  };
}

export function emptyExperienceDraft(row?: ExperienceRow | null): ExperienceDraft {
  return {
    role_title: row?.role_title ?? "",
    place: row?.place ?? "",
    start_year: row?.start_year != null ? String(row.start_year) : "",
    end_year: row?.end_year != null ? String(row.end_year) : "",
    is_current: row?.is_current ?? false,
    description: row?.description ?? "",
  };
}

export function emptyCertificateDraft(row?: CertificateRow | null): CertificateDraft {
  return {
    title: row?.title ?? "",
    issuer: row?.issuer ?? "",
    issued_year: row?.issued_year != null ? String(row.issued_year) : "",
    hasFile: !!row?.file_path,
  };
}

/** «2018 – 2022», «2020 – لحد دلوقتي», «2019» or "" when no years were entered. */
export function yearRange(
  start: number | null,
  end: number | null,
  current: boolean,
  presentLabel: string,
): string {
  if (start === null && end === null && !current) return "";
  if (current) return start !== null ? `${start} – ${presentLabel}` : presentLabel;
  if (start !== null && end !== null) return start === end ? String(start) : `${start} – ${end}`;
  return String(start ?? end);
}

const safeExt = (name: string, type: string) => {
  if (type === "application/pdf") return "pdf";
  const fromName = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp", "heic"].includes(fromName))
    return fromName === "jpeg" ? "jpg" : fromName;
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic") return "heic";
  return "jpg";
};

export function credentialFilePath(
  providerId: string,
  kind: "certificate" | "education",
  fileName: string,
  mimeType: string,
  id: string,
) {
  return `${providerId}/${kind}/${id}.${safeExt(fileName, mimeType)}`;
}

export function credentialFileError(
  sizeBytes: number | null | undefined,
  mimeType: string | null | undefined,
) {
  if (!mimeType || !(CREDENTIAL_FILE_TYPES as readonly string[]).includes(mimeType.toLowerCase()))
    return "type" as const;
  if (sizeBytes != null && sizeBytes > CREDENTIAL_FILE_MAX_BYTES) return "size" as const;
  return null;
}

// ---------- data access ----------

export async function fetchMyCredentials(
  client: unknown,
  providerId: string,
): Promise<ProviderCredentials> {
  const db = loose(client);
  const [education, experience, certificates] = await Promise.all([
    db
      .from("provider_education")
      .select("*")
      .eq("provider_id", providerId)
      .order("end_year", { ascending: false, nullsFirst: true })
      .order("created_at"),
    db
      .from("provider_work_experience")
      .select("*")
      .eq("provider_id", providerId)
      .order("is_current", { ascending: false })
      .order("end_year", { ascending: false, nullsFirst: true })
      .order("created_at"),
    db.from("provider_certificates").select("*").eq("provider_id", providerId).order("created_at"),
  ]);
  for (const r of [education, experience, certificates]) if (r.error) throw r.error;
  return {
    education: (education.data ?? []) as EducationRow[],
    experience: (experience.data ?? []) as ExperienceRow[],
    certificates: (certificates.data ?? []) as CertificateRow[],
  };
}

export async function fetchPublicCredentials(
  client: unknown,
  providerId: string,
): Promise<PublicCredentials> {
  const { data, error } = await loose(client).rpc("public_provider_credentials", {
    p_provider_id: providerId,
  });
  if (error) throw error;
  const d = (data ?? {}) as Partial<PublicCredentials>;
  return {
    education: d.education ?? [],
    experience: d.experience ?? [],
    certificates: d.certificates ?? [],
  };
}

export async function saveEducation(
  client: unknown,
  providerId: string,
  draft: EducationDraft,
  id?: string,
) {
  const db = loose(client);
  const payload = educationPayload(draft);
  const q = id
    ? db.from("provider_education").update(payload).eq("id", id)
    : db.from("provider_education").insert({ ...payload, provider_id: providerId });
  const { error } = await q;
  if (error) throw error;
}

export async function saveExperience(
  client: unknown,
  providerId: string,
  draft: ExperienceDraft,
  id?: string,
) {
  const db = loose(client);
  const payload = experiencePayload(draft);
  const q = id
    ? db.from("provider_work_experience").update(payload).eq("id", id)
    : db.from("provider_work_experience").insert({ ...payload, provider_id: providerId });
  const { error } = await q;
  if (error) throw error;
}

export type UploadableFile = {
  body: Blob | ArrayBuffer | Uint8Array;
  name: string;
  type: string;
  size?: number | null;
};

export async function uploadCredentialFile(
  client: unknown,
  providerId: string,
  kind: "certificate" | "education",
  file: UploadableFile,
  id: string,
) {
  const path = credentialFilePath(providerId, kind, file.name, file.type, id);
  const { error } = await loose(client)
    .storage.from(CREDENTIALS_BUCKET)
    .upload(path, file.body, { contentType: file.type, upsert: true });
  if (error) throw error;
  return path;
}

export async function saveCertificate(
  client: unknown,
  providerId: string,
  draft: CertificateDraft,
  opts: { id?: string; filePath?: string | null },
) {
  const db = loose(client);
  const base = {
    title: draft.title.trim(),
    issuer: draft.issuer.trim(),
    issued_year: yearOrNull(draft.issued_year),
  };
  const q = opts.id
    ? db
        .from("provider_certificates")
        .update(opts.filePath ? { ...base, file_path: opts.filePath } : base)
        .eq("id", opts.id)
    : db
        .from("provider_certificates")
        .insert({ ...base, provider_id: providerId, file_path: opts.filePath });
  const { error } = await q;
  if (error) throw error;
}

export async function deleteCredential(
  client: unknown,
  table: "provider_education" | "provider_work_experience" | "provider_certificates",
  id: string,
  filePath?: string | null,
) {
  const db = loose(client);
  const { error } = await db.from(table).delete().eq("id", id);
  if (error) throw error;
  if (filePath) {
    // Best effort: the row is gone, an orphan private file is harmless and stays readable only by owner/admin.
    try {
      await db.storage.from(CREDENTIALS_BUCKET).remove([filePath]);
    } catch {
      // ignore
    }
  }
}

export async function signedCredentialUrl(client: unknown, path: string, seconds = 300) {
  const { data, error } = await loose(client)
    .storage.from(CREDENTIALS_BUCKET)
    .createSignedUrl(path, seconds);
  if (error) throw error;
  return (data?.signedUrl as string | undefined) ?? null;
}

export async function reviewCertificate(
  client: unknown,
  certificateId: string,
  status: CertificateStatus,
  note?: string | null,
) {
  const { error } = await loose(client).rpc("admin_review_provider_certificate", {
    p_certificate_id: certificateId,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) throw error;
}

export function credentialErrorKey(error: unknown): string {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error ?? "");
  if (msg.includes("CREDENTIAL_LIMIT_REACHED")) return "providerCredentials.errors.limit";
  if (msg.includes("CERTIFICATE_REJECT_REASON_REQUIRED"))
    return "providerCredentials.errors.rejectReason";
  if (/mime|type|size|payload too large|exceeded/i.test(msg))
    return "providerCredentials.errors.file";
  return "providerCredentials.errors.generic";
}
