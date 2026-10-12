import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderDocumentsView } from "@/components/provider/ProviderDocumentsView";

export const Route = createFileRoute("/preview/pro/documents")({ component: PreviewDocuments });

function PreviewDocuments() {
  const { t } = useTranslation();
  return <ProviderDocumentsView status="APPROVED" onUpload={() => {}} documents={[
    { id: "preview-front", type: "id_card_front", status: "approved", rejected_reason: null },
    { id: "preview-back", type: "id_card_back", status: "pending", rejected_reason: null },
    { id: "preview-certificate", type: "certificate", status: "rejected", rejected_reason: t("providerApply.photoHint") },
  ]} />;
}
