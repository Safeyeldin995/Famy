import { useState } from "react";
import { ArrowLeft, Award, BriefcaseBusiness, FileUp, GraduationCap, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  credentialErrorKey,
  CREDENTIAL_MAX_ROWS,
  emptyCertificateDraft,
  emptyEducationDraft,
  emptyExperienceDraft,
  validateCertificate,
  validateEducation,
  validateExperience,
  yearRange,
  type CertificateDraft,
  type CertificateRow,
  type EducationDraft,
  type EducationRow,
  type ExperienceDraft,
  type ExperienceRow,
  type CredentialKind,
} from "@/lib/provider/credentials";
import { useCredentialMutations, useMyCredentials } from "@/lib/db/credential-queries";
import { QueryError } from "@/components/famio/QueryError";
import "@/components/famio/providerApply.css";

const TABLE = {
  education: "provider_education",
  experience: "provider_work_experience",
  certificates: "provider_certificates",
} as const;

const ICON = { education: GraduationCap, experience: BriefcaseBusiness, certificates: Award };

type Row = EducationRow | ExperienceRow | CertificateRow;

function FieldError({ id, k }: { id: string; k?: string }) {
  const { t } = useTranslation();
  if (!k) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {t(`providerCredentials.fieldErrors.${k}`)}
    </p>
  );
}

export function CredentialsPage({
  kind,
  providerId,
  onBack,
}: {
  kind: CredentialKind;
  providerId: string;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <main className="apply-ui apply-screen apply-setup-screen" dir={i18n.dir()}>
      <header className="apply-header">
        <button type="button" className="apply-back" onClick={onBack} aria-label={t("common.back")}>
          <ArrowLeft size={20} className="rtl:rotate-180" />
        </button>
      </header>
      <div className="apply-content">
        <h1 className="apply-title">{t(`providerCredentials.${kind}.title`)}</h1>
        <p className="apply-subtitle">{t(`providerCredentials.${kind}.hint`)}</p>
        <CredentialsEditor kind={kind} providerId={providerId} />
      </div>
    </main>
  );
}

export function CredentialsEditor({
  kind,
  providerId,
}: {
  kind: CredentialKind;
  providerId: string;
}) {
  const { t } = useTranslation();
  const q = useMyCredentials(providerId);
  const m = useCredentialMutations(providerId);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState("");
  const Icon = ICON[kind];
  if (q.isError) return <QueryError onRetry={() => void q.refetch()} />;
  if (!q.data)
    return (
      <p role="status" className="text-muted-foreground">
        {t("common.loading")}
      </p>
    );
  const rows: Row[] =
    kind === "education"
      ? q.data.education
      : kind === "experience"
        ? q.data.experience
        : q.data.certificates;

  const remove = async (row: Row) => {
    setError("");
    try {
      await m.remove.mutateAsync({
        table: TABLE[kind],
        id: row.id,
        filePath:
          kind === "certificates"
            ? (row as CertificateRow).file_path
            : kind === "education"
              ? (row as EducationRow).proof_path
              : null,
      });
      setConfirmDelete(null);
    } catch (e) {
      setError(t(credentialErrorKey(e)));
    }
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl bg-brand/10 p-4 text-sm">
        <p className="font-bold text-brand">{t("providerCredentials.tipsTitle")}</p>
        <p className="mt-1">{t(`providerCredentials.tips.${kind}`)}</p>
        {kind === "certificates" ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("providerCredentials.certificates.privacy")}
          </p>
        ) : null}
      </div>

      {rows.length === 0 && editing !== "new" ? (
        <div className="grid justify-items-center gap-2 rounded-2xl border border-border p-6 text-muted-foreground">
          <Icon size={28} aria-hidden />
          <p>{t(`providerCredentials.${kind}.empty`)}</p>
        </div>
      ) : null}

      <ul className="grid gap-3" aria-label={t(`providerCredentials.${kind}.title`)}>
        {rows.map((row) =>
          editing === row.id ? (
            <li key={row.id}>
              <EntryForm
                kind={kind}
                row={row}
                providerId={providerId}
                onDone={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={row.id} className="grid gap-3 rounded-2xl border border-border p-4">
              <EntrySummary kind={kind} row={row} />
              <div className="flex flex-wrap gap-2">
                {confirmDelete === row.id ? (
                  <>
                    <button
                      type="button"
                      className="min-h-11 rounded-xl bg-destructive px-4 font-bold text-destructive-foreground disabled:opacity-60"
                      disabled={m.remove.isPending}
                      onClick={() => void remove(row)}
                    >
                      {t("providerCredentials.removeConfirm")}
                    </button>
                    <button
                      type="button"
                      className="min-h-11 px-3 font-bold"
                      onClick={() => setConfirmDelete(null)}
                    >
                      {t("providerCredentials.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="min-h-11 rounded-xl border border-border px-4 font-bold"
                      onClick={() => setEditing(row.id)}
                    >
                      {t("providerCredentials.edit")}
                    </button>
                    <button
                      type="button"
                      className="min-h-11 px-3 font-bold text-muted-foreground"
                      onClick={() => setConfirmDelete(row.id)}
                    >
                      {t("providerCredentials.remove")}
                    </button>
                  </>
                )}
              </div>
            </li>
          ),
        )}
      </ul>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {editing === "new" ? (
        <EntryForm kind={kind} providerId={providerId} onDone={() => setEditing(null)} />
      ) : rows.length < CREDENTIAL_MAX_ROWS ? (
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-brand font-bold text-brand"
        >
          <Plus size={18} aria-hidden />
          {t(`providerCredentials.${kind}.add`)}
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">{t("providerCredentials.errors.limit")}</p>
      )}
    </div>
  );
}

export function EntrySummary({ kind, row }: { kind: CredentialKind; row: Row }) {
  const { t } = useTranslation();
  const present = t("providerCredentials.present");
  if (kind === "education") {
    const r = row as EducationRow;
    const years = yearRange(r.start_year, r.end_year, false, present);
    return (
      <div className="min-w-0">
        <p className="font-extrabold">
          {r.degree}
          {r.field_of_study ? ` · ${r.field_of_study}` : ""}
        </p>
        <p className="text-sm text-muted-foreground">
          {r.institution}
          {years ? <span dir="ltr"> · {years}</span> : null}
        </p>
      </div>
    );
  }
  if (kind === "experience") {
    const r = row as ExperienceRow;
    const years = yearRange(r.start_year, r.end_year, r.is_current, present);
    return (
      <div className="min-w-0">
        <p className="font-extrabold">{r.role_title}</p>
        <p className="text-sm text-muted-foreground">
          {r.place}
          {years ? ` · ${years}` : ""}
        </p>
        {r.description ? (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.description}</p>
        ) : null}
      </div>
    );
  }
  const r = row as CertificateRow;
  const tone =
    r.status === "verified"
      ? "text-success"
      : r.status === "rejected"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className="min-w-0">
      <p className="font-extrabold">{r.title}</p>
      <p className="text-sm text-muted-foreground">
        {r.issuer}
        {r.issued_year ? ` · ${r.issued_year}` : ""}
      </p>
      <p className={`mt-1 text-sm font-bold ${tone}`}>
        {t(`providerCredentials.certificates.status.${r.status}`)}
      </p>
      {r.status === "rejected" && r.review_note ? <p className="text-sm">{r.review_note}</p> : null}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
  year,
  multiline,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  year?: boolean;
  multiline?: boolean;
}) {
  const errorId = `${id}-error`;
  const common = {
    id,
    value,
    placeholder,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
  } as const;
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="apply-label">
        {label}
      </label>
      {multiline ? (
        <textarea
          {...common}
          className="apply-input !h-28 py-3"
          maxLength={1000}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          {...common}
          className="apply-input"
          dir={year ? "ltr" : undefined}
          inputMode={year ? "numeric" : undefined}
          maxLength={year ? 4 : 160}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <FieldError id={errorId} k={error} />
    </div>
  );
}

function EntryForm({
  kind,
  row,
  providerId,
  onDone,
}: {
  kind: CredentialKind;
  row?: Row;
  providerId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const m = useCredentialMutations(providerId);
  const [edu, setEdu] = useState<EducationDraft>(() => emptyEducationDraft(row as EducationRow));
  const [exp, setExp] = useState<ExperienceDraft>(() => emptyExperienceDraft(row as ExperienceRow));
  const [cert, setCert] = useState<CertificateDraft>(() =>
    emptyCertificateDraft(row as CertificateRow),
  );
  const [file, setFile] = useState<File | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const errors: Record<string, string | undefined> =
    kind === "education"
      ? validateEducation(edu)
      : kind === "experience"
        ? validateExperience(exp)
        : validateCertificate({ ...cert, hasFile: cert.hasFile || !!file });
  const show = (k: string) => (attempted ? errors[k] : undefined);
  const busy = m.education.isPending || m.experience.isPending || m.certificate.isPending;
  const base = `cred-${kind}-${row?.id ?? "new"}`;

  const save = async () => {
    if (busy) return;
    setAttempted(true);
    if (Object.values(errors).some(Boolean)) return;
    setError("");
    try {
      if (kind === "education") await m.education.mutateAsync({ draft: edu, id: row?.id });
      else if (kind === "experience") await m.experience.mutateAsync({ draft: exp, id: row?.id });
      else await m.certificate.mutateAsync({ draft: cert, id: row?.id, file });
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "file_too_large") setError(t("providerCredentials.fieldErrors.fileSize"));
      else if (msg === "invalid_file_type") setError(t("providerCredentials.fieldErrors.fileType"));
      else setError(t(credentialErrorKey(e)));
    }
  };

  return (
    <form
      className="grid gap-3 rounded-2xl border-2 border-brand p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={busy} className="contents">
        {kind === "education" ? (
          <>
            <TextField
              id={`${base}-institution`}
              label={t("providerCredentials.education.institution")}
              placeholder={t("providerCredentials.education.institutionPlaceholder")}
              value={edu.institution}
              onChange={(institution) => setEdu((d) => ({ ...d, institution }))}
              error={show("institution")}
            />
            <TextField
              id={`${base}-degree`}
              label={t("providerCredentials.education.degree")}
              placeholder={t("providerCredentials.education.degreePlaceholder")}
              value={edu.degree}
              onChange={(degree) => setEdu((d) => ({ ...d, degree }))}
              error={show("degree")}
            />
            <TextField
              id={`${base}-field`}
              label={t("providerCredentials.education.field")}
              placeholder={t("providerCredentials.education.fieldPlaceholder")}
              value={edu.field_of_study}
              onChange={(field_of_study) => setEdu((d) => ({ ...d, field_of_study }))}
              error={show("field_of_study")}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                id={`${base}-start`}
                year
                label={t("providerCredentials.startYear")}
                placeholder={t("providerCredentials.yearPlaceholder")}
                value={edu.start_year}
                onChange={(start_year) => setEdu((d) => ({ ...d, start_year }))}
                error={show("start_year")}
              />
              <TextField
                id={`${base}-end`}
                year
                label={t("providerCredentials.endYear")}
                placeholder={t("providerCredentials.yearPlaceholder")}
                value={edu.end_year}
                onChange={(end_year) => setEdu((d) => ({ ...d, end_year }))}
                error={show("end_year")}
              />
            </div>
          </>
        ) : null}

        {kind === "experience" ? (
          <>
            <TextField
              id={`${base}-role`}
              label={t("providerCredentials.experience.role")}
              placeholder={t("providerCredentials.experience.rolePlaceholder")}
              value={exp.role_title}
              onChange={(role_title) => setExp((d) => ({ ...d, role_title }))}
              error={show("role_title")}
            />
            <TextField
              id={`${base}-place`}
              label={t("providerCredentials.experience.place")}
              placeholder={t("providerCredentials.experience.placePlaceholder")}
              value={exp.place}
              onChange={(place) => setExp((d) => ({ ...d, place }))}
              error={show("place")}
            />
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--brand)]"
                checked={exp.is_current}
                onChange={(e) =>
                  setExp((d) => ({
                    ...d,
                    is_current: e.target.checked,
                    end_year: e.target.checked ? "" : d.end_year,
                  }))
                }
              />
              <span>{t("providerCredentials.experience.current")}</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <TextField
                id={`${base}-start`}
                year
                label={t("providerCredentials.startYear")}
                placeholder={t("providerCredentials.yearPlaceholder")}
                value={exp.start_year}
                onChange={(start_year) => setExp((d) => ({ ...d, start_year }))}
                error={show("start_year")}
              />
              {!exp.is_current ? (
                <TextField
                  id={`${base}-end`}
                  year
                  label={t("providerCredentials.endYear")}
                  placeholder={t("providerCredentials.yearPlaceholder")}
                  value={exp.end_year}
                  onChange={(end_year) => setExp((d) => ({ ...d, end_year }))}
                  error={show("end_year")}
                />
              ) : null}
            </div>
            <TextField
              id={`${base}-description`}
              multiline
              label={t("providerCredentials.experience.description")}
              placeholder={t("providerCredentials.experience.descriptionPlaceholder")}
              value={exp.description}
              onChange={(description) => setExp((d) => ({ ...d, description }))}
              error={show("description")}
            />
          </>
        ) : null}

        {kind === "certificates" ? (
          <>
            <TextField
              id={`${base}-title`}
              label={t("providerCredentials.certificates.titleField")}
              placeholder={t("providerCredentials.certificates.titlePlaceholder")}
              value={cert.title}
              onChange={(title) => setCert((d) => ({ ...d, title }))}
              error={show("title")}
            />
            <TextField
              id={`${base}-issuer`}
              label={t("providerCredentials.certificates.issuer")}
              placeholder={t("providerCredentials.certificates.issuerPlaceholder")}
              value={cert.issuer}
              onChange={(issuer) => setCert((d) => ({ ...d, issuer }))}
              error={show("issuer")}
            />
            <TextField
              id={`${base}-year`}
              year
              label={t("providerCredentials.certificates.year")}
              placeholder={t("providerCredentials.yearPlaceholder")}
              value={cert.issued_year}
              onChange={(issued_year) => setCert((d) => ({ ...d, issued_year }))}
              error={show("issued_year")}
            />
            <div className="grid gap-2">
              <span className="apply-label">{t("providerCredentials.certificates.file")}</span>
              {file || cert.hasFile ? (
                <p className="break-all text-sm text-success">
                  {file?.name ?? t("providerCredentials.certificates.fileReady")}
                </p>
              ) : null}
              <label className="apply-capture relative w-fit">
                <span>
                  <FileUp size={16} aria-hidden />
                  {t(
                    file || cert.hasFile
                      ? "providerCredentials.certificates.replaceFile"
                      : "providerCredentials.certificates.pickFile",
                  )}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                  aria-label={t("providerCredentials.certificates.file")}
                  className="absolute inset-0 opacity-0"
                  onChange={(e) => {
                    const next = e.target.files?.[0];
                    if (next) setFile(next);
                  }}
                />
              </label>
              <FieldError id={`${base}-file-error`} k={show("hasFile")} />
            </div>
          </>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-brand px-5 font-bold text-brand-foreground disabled:opacity-60"
          >
            {busy ? t("providerApply.saving") : t("providerCredentials.save")}
          </button>
          <button type="button" className="min-h-11 px-3 font-bold" onClick={onDone}>
            {t("providerCredentials.cancel")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
