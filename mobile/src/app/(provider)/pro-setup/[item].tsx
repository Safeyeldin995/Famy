import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { mergeExperiencePayload, type SetupSnapshot } from "@shared/provider/setupHelpers";
import type { OnboardingReference } from "@shared/provider/onboardingReferences";
import {
  useChildAgeGroups,
  useMyReferences,
  useMySavedSelections,
  useOnboardingSnapshot,
  usePhase1Services,
  useSaveOnboardingSection,
  useSecureUploadDocument,
} from "@/lib/provider/onboardingQueries";
import { uploadAvatar, type PickedFile } from "@/lib/provider/documentUpload";
import {
  useMyProvider,
  useProviderAvailability,
  useReplaceAvailability,
} from "@/lib/provider/queries";
import { SetupItemForm } from "@/ui/provider/SetupItemForm";
import { Page, QueryState } from "@/ui/Page";

const SETUP_ITEMS = [
  "photo",
  "about",
  "babysitting",
  "subjects",
  "reference",
  "personal",
  "hours",
] as const;

export default function ProSetupItemScreen() {
  const { item } = useLocalSearchParams<{ item: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const providerQ = useMyProvider();
  const provider = providerQ.data as Record<string, unknown> | null | undefined;
  const providerId = provider?.id as string | undefined;
  const profileId = provider?.profile_id as string | undefined;
  const snapshot = useOnboardingSnapshot();
  const refs = useMyReferences(providerId);
  const selections = useMySavedSelections(providerId);
  const services = usePhase1Services();
  const ages = useChildAgeGroups();
  const availability = useProviderAvailability(providerId);
  const save = useSaveOnboardingSection();
  const replace = useReplaceAvailability();
  const upload = useSecureUploadDocument();

  if (!item || !SETUP_ITEMS.includes(item as (typeof SETUP_ITEMS)[number])) {
    router.replace("/pro-setup-home");
    return null;
  }

  const queries = [providerQ, snapshot, refs, selections, services, ages, availability];
  const ready = !!provider && queries.every((q) => q.isSuccess && !q.isLoading);

  const persist = async (edits: Record<string, unknown>) => {
    if (!providerId || !profileId) return;
    if (edits.profilePhoto) {
      const file = edits.profilePhoto as PickedFile;
      await uploadAvatar(profileId, file);
      await upload.mutateAsync({ type: "profile_photo", file });
      await qc.invalidateQueries({ queryKey: ["provider-onboarding-snapshot"] });
      await qc.invalidateQueries({ queryKey: ["my-provider"] });
      router.back();
      return;
    }
    if (edits.experience) {
      const current = await snapshot.refetch();
      if (current.error || !current.data) throw current.error ?? new Error("snapshot");
      const serviceList = (services.data ?? []) as { id: string; category?: { slug?: string } }[];
      const selected = serviceList.filter((s) =>
        (selections.data?.services ?? []).some(
          (row: { service_id: string }) => row.service_id === s.id,
        ),
      );
      const needsBabysitting = selected.some((s) => s.category?.slug === "babysitting");
      await save.mutateAsync({
        section: "experience",
        payload: mergeExperiencePayload(
          { ...(current.data as SetupSnapshot), needsBabysitting },
          edits.experience as Parameters<typeof mergeExperiencePayload>[1],
        ),
      });
    }
    if (edits.references) {
      await save.mutateAsync({
        section: "references",
        payload: { references: edits.references },
      });
    }
    if (edits.personal) {
      await save.mutateAsync({
        section: "personal",
        payload: edits.personal as Record<string, unknown>,
      });
    }
    if (edits.rules) {
      await replace.mutateAsync({
        providerId,
        rules: edits.rules as { weekday: number; start_time: string; end_time: string }[],
      });
    }
    router.back();
  };

  let body = null;
  if (ready) {
    const serviceList = (services.data ?? []) as { id: string; category?: { slug?: string } }[];
    const selected = serviceList.filter((s) =>
      (selections.data?.services ?? []).some(
        (row: { service_id: string }) => row.service_id === s.id,
      ),
    );
    const needsBabysitting = selected.some((s) => s.category?.slug === "babysitting");
    const normalizedRefs = ((refs.data ?? []) as OnboardingReference[]).map((row) => ({
      full_name: row.full_name,
      relationship: row.relationship,
      phone: row.phone,
      notes: row.notes ?? "",
    }));
    body = (
      <SetupItemForm
        item={item}
        snapshot={{
          ...(snapshot.data as SetupSnapshot),
          needsBabysitting,
        }}
        references={normalizedRefs}
        rules={
          (availability.data ?? []) as {
            weekday: number;
            start_time: string;
            end_time: string;
          }[]
        }
        needsBabysitting={needsBabysitting}
        ageGroups={(ages.data ?? []) as { code: string; name_ar: string; name_en: string }[]}
        providerId={providerId!}
        profileId={profileId!}
        onSave={persist}
      />
    );
  }

  return (
    <Page title={t(`providerSetup.titles.${item}`)} queries={queries}>
      <QueryState query={providerQ}>{body}</QueryState>
    </Page>
  );
}
