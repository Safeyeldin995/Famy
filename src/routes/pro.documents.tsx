import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ProviderDocumentsView } from "@/components/provider/ProviderDocumentsView";
import { useMyProvider, useProviderDocuments } from "@/lib/db/provider-queries";
import { useSecureUploadDocument } from "@/lib/provider/onboarding-queries";

export const Route = createFileRoute("/pro/documents")({ component: ProviderDocuments });

function ProviderDocuments() {
  const { t } = useTranslation();
  const provider = useMyProvider();
  const documents = useProviderDocuments(provider.data?.id);
  const upload = useSecureUploadDocument();
  return <ProviderDocumentsView
    status={provider.data?.onboarding_status}
    documents={documents.data ?? []}
    loading={provider.isLoading || (!!provider.data && documents.isLoading)}
    failed={provider.isError || documents.isError || (!provider.isLoading && !provider.data)}
    onRetry={() => { void provider.refetch(); void documents.refetch(); }}
    busy={upload.isPending}
    onUpload={(type, file) => upload.mutate({ type, file }, {
      onSuccess: () => toast.success(t("pro.onboardingWizard.uploaded")),
      onError: () => toast.error(t("pro.onboardingWizard.uploadError")),
    })}
  />;
}
