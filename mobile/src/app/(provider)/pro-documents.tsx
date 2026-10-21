import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  canUploadDocument,
  onboardingEditable,
  useSecureUploadDocument,
  type OnboardingStatus,
} from "@/lib/provider/onboardingQueries";
import { useProviderDocuments } from "@/lib/provider/profileQueries";
import { useMyProvider } from "@/lib/provider/queries";
import { DocumentUploadCard } from "@/ui/provider/DocumentUploadCard";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { proCard } from "@/ui/provider/cards";

const REQUIRED: Array<"id_card_front" | "id_card_back"> = ["id_card_front", "id_card_back"];
const OPTIONAL: Array<"certificate" | "other"> = ["certificate", "other"];

export default function ProDocumentsScreen() {
  const { t } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const status = provider?.onboarding_status as OnboardingStatus | undefined;
  const docsQ = useProviderDocuments(provider?.id as string | undefined);
  const upload = useSecureUploadDocument();

  return (
    <Page title={t("providerDocuments.title")} queries={[p, docsQ]}>
      <QueryState query={p}>
        <QueryState query={docsQ}>
          {!onboardingEditable(status) ? (
            <Text tone="muted">{t("providerDocuments.readOnly")}</Text>
          ) : null}
          {REQUIRED.map((type) => {
            const doc = docsQ.data?.find((d: { type: string }) => d.type === type);
            const allowed = canUploadDocument(status, type);
            return (
              <DocumentUploadCard
                key={type}
                title={t(`providerDocuments.${type}`)}
                statusLabel={t(`providerDocuments.${doc?.status ?? "missing"}`)}
                rejectedReason={doc?.rejected_reason}
                captured={!!doc}
                disabled={!allowed || upload.isPending}
                onPick={async (file) => {
                  await upload.mutateAsync({ type, file });
                }}
              />
            );
          })}
          {OPTIONAL.map((type) => {
            const doc = docsQ.data?.find((d: { type: string }) => d.type === type);
            const allowed = canUploadDocument(status, type);
            if (!doc && !allowed) return null;
            return (
              <DocumentUploadCard
                key={type}
                title={t(`providerDocuments.${type === "certificate" ? type : "otherDocument"}`)}
                statusLabel={t(`providerDocuments.${doc?.status ?? "missing"}`)}
                rejectedReason={doc?.rejected_reason}
                captured={!!doc}
                disabled={!allowed || upload.isPending}
                onPick={async (file) => {
                  await upload.mutateAsync({ type, file });
                }}
              />
            );
          })}
          {(docsQ.data ?? [])
            .filter(
              (d: { type: string }) =>
                !REQUIRED.includes(d.type as "id_card_front") &&
                !OPTIONAL.includes(d.type as "certificate"),
            )
            .map((doc: { id: string; type: string; status: string; rejected_reason?: string }) => (
              <View key={doc.id} style={proCard.card}>
                <Text weight="bold">{doc.type}</Text>
                <Text tone="muted">{t(`providerDocuments.${doc.status}`)}</Text>
              </View>
            ))}
        </QueryState>
      </QueryState>
    </Page>
  );
}
