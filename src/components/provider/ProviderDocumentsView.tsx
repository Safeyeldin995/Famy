import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IdCaptureCard } from "@/components/famio/IdCaptureCard";
import { PageHeader } from "@/components/famio/PageHeader";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { QueryError } from "@/components/famio/QueryError";
import { onboardingEditable, type OnboardingStatus } from "@/lib/provider/onboarding-queries";
import type { Database } from "@/integrations/supabase/types";

// Deliberately exclude private storage paths, reviewer identity and internal notes.
export type PublicDocument = Pick<
  Database["public"]["Tables"]["provider_documents"]["Row"],
  "id" | "type" | "status" | "rejected_reason"
>;
type DocumentType = PublicDocument["type"];
type UploadType = "id_card_front" | "id_card_back" | "profile_photo" | "certificate" | "other";

/** Mirrors prepare/finalize_document_upload; the server remains authoritative. */
export function canUploadDocument(
  status: OnboardingStatus | undefined,
  type: DocumentType,
): type is UploadType {
  if (!["id_card_front", "id_card_back", "profile_photo", "certificate", "other"].includes(type))
    return false;
  return (
    onboardingEditable(status) ||
    (type === "profile_photo" && (status === "SUBMITTED" || status === "UNDER_REVIEW"))
  );
}

export function ProviderDocumentsView({
  documents,
  status,
  onUpload,
  busy = false,
  loading = false,
  failed = false,
  onRetry = () => {},
}: {
  documents: PublicDocument[];
  status?: OnboardingStatus;
  onUpload: (type: UploadType, file: File) => void;
  busy?: boolean;
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const label = (type: DocumentType) =>
    t(
      `providerDocuments.${["id_card_front", "id_card_back", "profile_photo", "certificate"].includes(type) ? type : "otherDocument"}`,
    );
  const statusLine = (doc?: PublicDocument) => (
    <div className="mt-2 px-4 pb-3">
      <span
        className={`apply-tag ${doc?.status === "approved" ? "apply-success" : doc?.status === "pending" ? "apply-wait" : doc ? "apply-danger" : ""}`}
      >
        {t(`providerDocuments.${doc?.status ?? "missing"}`)}
      </span>
      {doc?.status === "rejected" && doc.rejected_reason && (
        <p className="mt-2 break-words text-pro-13 text-destructive">{doc.rejected_reason}</p>
      )}
    </div>
  );
  const otherDocs = documents.filter(
    (doc) => doc.type !== "id_card_front" && doc.type !== "id_card_back",
  );
  return (
    <ProviderShell hideNav>
      <PageHeader title={t("providerDocuments.title")} backTo="/pro/profile" />
      <div className="apply-ui space-y-4 px-5 pb-10">
        {loading ? (
          <div
            role="status"
            className="h-40 animate-pulse rounded-2xl bg-muted"
            aria-label={t("common.loading")}
          />
        ) : failed ? (
          <QueryError onRetry={onRetry} />
        ) : (
          <>
            {!onboardingEditable(status) && (
              <p className="text-pro-13 text-muted-foreground">{t("providerDocuments.readOnly")}</p>
            )}
            {(["id_card_front", "id_card_back"] as const).map((type) => {
              const doc = documents.find((item) => item.type === type);
              const allowed = canUploadDocument(status, type);
              return (
                <section key={type} className="apply-list">
                  <IdCaptureCard
                    title={label(type)}
                    captured={!!doc}
                    disabled={!allowed || busy}
                    readOnly={!allowed}
                    allowReplace={!!doc && allowed}
                    actionLabel={t(doc ? "providerDocuments.replace" : "providerDocuments.upload")}
                    accept="image/jpeg,image/png,application/pdf"
                    onCapture={(file) => {
                      if (allowed) onUpload(type, file);
                    }}
                  />
                  {statusLine(doc)}
                </section>
              );
            })}
            <h2 className="text-pro-13 font-bold">{t("providerDocuments.other")}</h2>
            <div className="apply-list">
              {otherDocs.map((doc) => (
                <section key={doc.id}>
                  <div className="apply-li">
                    <FileText size={20} aria-hidden="true" />
                    <span className="flex-1 text-sm font-bold">{label(doc.type)}</span>
                    {canUploadDocument(status, doc.type) && (
                      <Upload
                        label={t("providerDocuments.replace")}
                        disabled={busy}
                        onUpload={(file) => {
                          if (canUploadDocument(status, doc.type)) onUpload(doc.type, file);
                        }}
                      />
                    )}
                  </div>
                  {statusLine(doc)}
                </section>
              ))}
              {(["certificate", "other"] as const)
                .filter(
                  (type) =>
                    !otherDocs.some((doc) => doc.type === type) && canUploadDocument(status, type),
                )
                .map((type) => (
                  <div className="apply-li" key={type}>
                    <FileText size={20} />
                    <span className="flex-1 text-sm">{label(type)}</span>
                    <Upload
                      label={t("providerDocuments.upload")}
                      disabled={busy}
                      onUpload={(file) => onUpload(type, file)}
                    />
                  </div>
                ))}
              {otherDocs.length === 0 && !onboardingEditable(status) && (
                <p className="p-4 text-pro-13 text-muted-foreground">
                  {t("providerDocuments.missing")}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </ProviderShell>
  );
}

function Upload({
  label,
  disabled,
  onUpload,
}: {
  label: string;
  disabled: boolean;
  onUpload: (file: File) => void;
}) {
  return (
    <label
      className={`relative inline-flex min-h-11 items-center text-pro-13 font-bold text-brand ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      {label}
      <input
        type="file"
        className="absolute inset-0 w-full cursor-pointer opacity-0"
        aria-label={label}
        accept="image/jpeg,image/png,application/pdf"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
          event.target.value = "";
        }}
      />
    </label>
  );
}
