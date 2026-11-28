import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { Award, BriefcaseBusiness, GraduationCap, Plus } from "lucide-react-native";
import {
  credentialErrorKey,
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
} from "@shared/provider/credentials";
import { useCredentialMutations, useMyCredentials } from "@/lib/provider/credentialQueries";
import type { PickedFile } from "@/lib/provider/documentUpload";
import { Field, QueryState } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { proCard } from "./cards";

export type CredentialKind = "education" | "experience" | "certificates";

const TABLE = {
  education: "provider_education",
  experience: "provider_work_experience",
  certificates: "provider_certificates",
} as const;

const ICON = { education: GraduationCap, experience: BriefcaseBusiness, certificates: Award };

function FieldError({ k }: { k?: string }) {
  const { t } = useTranslation();
  if (!k) return null;
  return (
    <Text tone="danger" size="sm" accessibilityLiveRegion="polite">
      {t(`providerCredentials.fieldErrors.${k}`)}
    </Text>
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
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState("");
  const Icon = ICON[kind];
  const rows: (EducationRow | ExperienceRow | CertificateRow)[] =
    kind === "education"
      ? (q.data?.education ?? [])
      : kind === "experience"
        ? (q.data?.experience ?? [])
        : (q.data?.certificates ?? []);

  const remove = async (row: EducationRow | ExperienceRow | CertificateRow) => {
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
    <QueryState query={q}>
      <View style={{ gap: space.lg }}>
        <Text tone="muted">{t(`providerCredentials.${kind}.hint`)}</Text>
        <View style={[proCard.card, { backgroundColor: colors.brandTint, gap: space.xs }]}>
          <Text weight="bold" size="sm" tone="brand">
            {t("providerCredentials.tipsTitle")}
          </Text>
          <Text size="sm">{t(`providerCredentials.tips.${kind}`)}</Text>
          {kind === "certificates" ? (
            <Text size="xs" tone="muted">
              {t("providerCredentials.certificates.privacy")}
            </Text>
          ) : null}
        </View>

        {rows.length === 0 && editing !== "new" ? (
          <View style={[proCard.card, { alignItems: "center", gap: space.sm }]}>
            <Icon size={28} color={colors.muted} />
            <Text tone="muted">{t(`providerCredentials.${kind}.empty`)}</Text>
          </View>
        ) : null}

        {rows.map((row) =>
          editing === row.id ? (
            <EntryForm
              key={row.id}
              kind={kind}
              row={row}
              providerId={providerId}
              onDone={() => setEditing(null)}
            />
          ) : (
            <View key={row.id} style={[proCard.card, { gap: space.sm }]}>
              <EntrySummary kind={kind} row={row} />
              {confirmDelete === row.id ? (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button
                    label={t("providerCredentials.removeConfirm")}
                    variant="secondary"
                    loading={m.remove.isPending}
                    onPress={() => void remove(row)}
                  />
                  <Button
                    label={t("providerCredentials.cancel")}
                    variant="ghost"
                    onPress={() => setConfirmDelete(null)}
                  />
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button
                    label={t("providerCredentials.edit")}
                    variant="secondary"
                    onPress={() => setEditing(row.id)}
                  />
                  <Button
                    label={t("providerCredentials.remove")}
                    variant="ghost"
                    onPress={() => setConfirmDelete(row.id)}
                  />
                </View>
              )}
            </View>
          ),
        )}

        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {editing === "new" ? (
          <EntryForm kind={kind} providerId={providerId} onDone={() => setEditing(null)} />
        ) : rows.length < 15 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(`providerCredentials.${kind}.add`)}
            onPress={() => setEditing("new")}
            style={{
              minHeight: 52,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: colors.brand,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.sm,
            }}
          >
            <Plus size={18} color={colors.brand} />
            <Text weight="bold" tone="brand">
              {t(`providerCredentials.${kind}.add`)}
            </Text>
          </Pressable>
        ) : (
          <Text tone="muted" size="sm">
            {t("providerCredentials.errors.limit")}
          </Text>
        )}
      </View>
    </QueryState>
  );
}

function EntrySummary({
  kind,
  row,
}: {
  kind: CredentialKind;
  row: EducationRow | ExperienceRow | CertificateRow;
}) {
  const { t } = useTranslation();
  const present = t("providerCredentials.present");
  if (kind === "education") {
    const r = row as EducationRow;
    const years = yearRange(r.start_year, r.end_year, false, present);
    return (
      <View style={{ gap: space.xs }}>
        <Text weight="heavy">
          {r.degree}
          {r.field_of_study ? ` · ${r.field_of_study}` : ""}
        </Text>
        <Text tone="muted" size="sm">
          {r.institution}
          {years ? ` · ${years}` : ""}
        </Text>
      </View>
    );
  }
  if (kind === "experience") {
    const r = row as ExperienceRow;
    const years = yearRange(r.start_year, r.end_year, r.is_current, present);
    return (
      <View style={{ gap: space.xs }}>
        <Text weight="heavy">{r.role_title}</Text>
        <Text tone="muted" size="sm">
          {r.place}
          {years ? ` · ${years}` : ""}
        </Text>
        {r.description ? <Text size="sm">{r.description}</Text> : null}
      </View>
    );
  }
  const r = row as CertificateRow;
  const tone = r.status === "verified" ? "success" : r.status === "rejected" ? "danger" : "muted";
  return (
    <View style={{ gap: space.xs }}>
      <Text weight="heavy">{r.title}</Text>
      <Text tone="muted" size="sm">
        {r.issuer}
        {r.issued_year ? ` · ${r.issued_year}` : ""}
      </Text>
      <Text size="sm" weight="bold" tone={tone}>
        {t(`providerCredentials.certificates.status.${r.status}`)}
      </Text>
      {r.status === "rejected" && r.review_note ? <Text size="sm">{r.review_note}</Text> : null}
    </View>
  );
}

function EntryForm({
  kind,
  row,
  providerId,
  onDone,
}: {
  kind: CredentialKind;
  row?: EducationRow | ExperienceRow | CertificateRow;
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
  const [file, setFile] = useState<PickedFile | null>(null);
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

  const pickFile = async (pdf: boolean) => {
    setError("");
    if (pdf) {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"],
        copyToCacheDirectory: true,
      });
      const a = !result.canceled ? result.assets[0] : null;
      if (a) setFile({ uri: a.uri, mimeType: a.mimeType, fileName: a.name, fileSize: a.size });
    } else {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
      });
      const a = !result.canceled ? result.assets[0] : null;
      if (a)
        setFile({
          uri: a.uri,
          mimeType: a.mimeType ?? "image/jpeg",
          fileName: a.fileName,
          fileSize: a.fileSize,
        });
    }
  };

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

  const yearProps = {
    keyboardType: "number-pad" as const,
    maxLength: 4,
    placeholder: t("providerCredentials.yearPlaceholder"),
    ltr: true,
    editable: !busy,
  };

  return (
    <View style={[proCard.card, { gap: space.md, borderWidth: 2, borderColor: colors.brand }]}>
      {kind === "education" ? (
        <>
          <Field
            label={t("providerCredentials.education.institution")}
            placeholder={t("providerCredentials.education.institutionPlaceholder")}
            value={edu.institution}
            onChangeText={(institution) => setEdu((d) => ({ ...d, institution }))}
            editable={!busy}
          />
          <FieldError k={show("institution")} />
          <Field
            label={t("providerCredentials.education.degree")}
            placeholder={t("providerCredentials.education.degreePlaceholder")}
            value={edu.degree}
            onChangeText={(degree) => setEdu((d) => ({ ...d, degree }))}
            editable={!busy}
          />
          <FieldError k={show("degree")} />
          <Field
            label={t("providerCredentials.education.field")}
            placeholder={t("providerCredentials.education.fieldPlaceholder")}
            value={edu.field_of_study}
            onChangeText={(field_of_study) => setEdu((d) => ({ ...d, field_of_study }))}
            editable={!busy}
          />
          <FieldError k={show("field_of_study")} />
          <View style={{ flexDirection: "row", gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Field
                label={t("providerCredentials.startYear")}
                value={edu.start_year}
                onChangeText={(start_year) => setEdu((d) => ({ ...d, start_year }))}
                {...yearProps}
              />
              <FieldError k={show("start_year")} />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={t("providerCredentials.endYear")}
                value={edu.end_year}
                onChangeText={(end_year) => setEdu((d) => ({ ...d, end_year }))}
                {...yearProps}
              />
              <FieldError k={show("end_year")} />
            </View>
          </View>
        </>
      ) : null}

      {kind === "experience" ? (
        <>
          <Field
            label={t("providerCredentials.experience.role")}
            placeholder={t("providerCredentials.experience.rolePlaceholder")}
            value={exp.role_title}
            onChangeText={(role_title) => setExp((d) => ({ ...d, role_title }))}
            editable={!busy}
          />
          <FieldError k={show("role_title")} />
          <Field
            label={t("providerCredentials.experience.place")}
            placeholder={t("providerCredentials.experience.placePlaceholder")}
            value={exp.place}
            onChangeText={(place) => setExp((d) => ({ ...d, place }))}
            editable={!busy}
          />
          <FieldError k={show("place")} />
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 44 }}
          >
            <Switch
              accessibilityLabel={t("providerCredentials.experience.current")}
              value={exp.is_current}
              onValueChange={(is_current) =>
                setExp((d) => ({ ...d, is_current, end_year: is_current ? "" : d.end_year }))
              }
              disabled={busy}
            />
            <Text>{t("providerCredentials.experience.current")}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Field
                label={t("providerCredentials.startYear")}
                value={exp.start_year}
                onChangeText={(start_year) => setExp((d) => ({ ...d, start_year }))}
                {...yearProps}
              />
              <FieldError k={show("start_year")} />
            </View>
            {!exp.is_current ? (
              <View style={{ flex: 1 }}>
                <Field
                  label={t("providerCredentials.endYear")}
                  value={exp.end_year}
                  onChangeText={(end_year) => setExp((d) => ({ ...d, end_year }))}
                  {...yearProps}
                />
                <FieldError k={show("end_year")} />
              </View>
            ) : null}
          </View>
          <Field
            label={t("providerCredentials.experience.description")}
            placeholder={t("providerCredentials.experience.descriptionPlaceholder")}
            value={exp.description}
            onChangeText={(description) => setExp((d) => ({ ...d, description }))}
            multiline
            maxLength={1000}
            editable={!busy}
            style={{ minHeight: 88, textAlignVertical: "top" }}
          />
          <FieldError k={show("description")} />
        </>
      ) : null}

      {kind === "certificates" ? (
        <>
          <Field
            label={t("providerCredentials.certificates.titleField")}
            placeholder={t("providerCredentials.certificates.titlePlaceholder")}
            value={cert.title}
            onChangeText={(title) => setCert((d) => ({ ...d, title }))}
            editable={!busy}
          />
          <FieldError k={show("title")} />
          <Field
            label={t("providerCredentials.certificates.issuer")}
            placeholder={t("providerCredentials.certificates.issuerPlaceholder")}
            value={cert.issuer}
            onChangeText={(issuer) => setCert((d) => ({ ...d, issuer }))}
            editable={!busy}
          />
          <FieldError k={show("issuer")} />
          <Field
            label={t("providerCredentials.certificates.year")}
            value={cert.issued_year}
            onChangeText={(issued_year) => setCert((d) => ({ ...d, issued_year }))}
            {...yearProps}
          />
          <FieldError k={show("issued_year")} />
          <Text weight="bold">{t("providerCredentials.certificates.file")}</Text>
          {file || cert.hasFile ? (
            <Text tone="success" size="sm">
              {file?.fileName || t("providerCredentials.certificates.fileReady")}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            <Button
              label={t(
                file || cert.hasFile
                  ? "providerCredentials.certificates.replaceFile"
                  : "providerCredentials.certificates.pickFile",
              )}
              variant="secondary"
              disabled={busy}
              onPress={() => void pickFile(false)}
            />
            <Button
              label="PDF"
              variant="ghost"
              disabled={busy}
              onPress={() => void pickFile(true)}
            />
          </View>
          <FieldError k={show("hasFile")} />
        </>
      ) : null}

      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label={t("providerCredentials.save")} loading={busy} onPress={() => void save()} />
        <Button
          label={t("providerCredentials.cancel")}
          variant="ghost"
          disabled={busy}
          onPress={onDone}
        />
      </View>
    </View>
  );
}
