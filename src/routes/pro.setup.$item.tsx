import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  ProviderSetupForm,
  setupItems,
  type SetupItem,
  type SetupEdits,
} from "@/components/provider/ProviderSetupForm";
import { GroupedTeachingSetup } from "@/components/provider/GroupedTeachingSetup";
import { QueryError } from "@/components/famio/QueryError";
import {
  useMyProvider,
  useProviderAvailability,
  useReplaceAvailability,
} from "@/lib/db/provider-queries";
import { useAvatarUrl } from "@/lib/db/queries";
import {
  useChildAgeGroups,
  useMyReferences,
  useMySavedSelections,
  useOnboardingSnapshot,
  usePhase1Services,
  useSaveOnboardingSection,
  useSecureUploadDocument,
} from "@/lib/provider/onboarding-queries";
import {
  useMyTeachingCapabilities,
  useRemoveTeachingCapability,
  useTeachingCurricula,
  useTeachingLevels,
  useTeachingSubjects,
  useTeachingSubjectServices,
} from "@/lib/db/teaching-queries";
import { useSaveTeachingGroup } from "@/lib/db/teaching-group-queries";
import {
  mergeExperiencePayload,
  mergeReferencesPayload,
  type SetupSnapshot,
} from "@/lib/provider/setupHelpers";
import { supabase } from "@/integrations/supabase/client";
export const Route = createFileRoute("/pro/setup/$item")({
  beforeLoad: ({ params }) => {
    if (!setupItems.includes(params.item as SetupItem)) throw notFound();
  },
  component: ProviderSetupRoute,
});
function ProviderSetupRoute() {
  const { item } = Route.useParams();
  const nav = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const provider = useMyProvider();
  const snapshot = useOnboardingSnapshot();
  const refs = useMyReferences(provider.data?.id);
  const selections = useMySavedSelections(provider.data?.id);
  const services = usePhase1Services();
  const ages = useChildAgeGroups();
  const availability = useProviderAvailability(provider.data?.id);
  const avatar = useAvatarUrl((snapshot.data as SetupSnapshot | undefined)?.profile?.avatar_url);
  const save = useSaveOnboardingSection();
  const replace = useReplaceAvailability();
  const upload = useSecureUploadDocument();
  const back = () => {
    void nav({ to: "/pro" });
  };
  const queries = [provider, snapshot, refs, selections, services, ages, availability];
  if (queries.some((q) => q.isError))
    return <QueryError onRetry={() => queries.forEach((q) => void q.refetch())} />;
  if (!provider.data || queries.some((q) => !q.isSuccess))
    return (
      <p role="status" className="p-5">
        {t("providerApply.loading")}
      </p>
    );
  const selectedServices = services.data!.filter((s) =>
    selections.data!.services.some((row) => row.service_id === s.id),
  );
  if (item === "subjects")
    return (
      <LiveSubjects
        providerId={provider.data.id}
        services={selectedServices.filter((s) => s.category?.slug === "tutoring")}
        onBack={back}
      />
    );
  const needsBabysitting = selectedServices.some((s) => s.category?.slug === "babysitting");
  const normalizedRefs = (rows: NonNullable<typeof refs.data>) =>
    rows.map((row) => ({
      full_name: row.full_name,
      relationship: row.relationship,
      phone: row.phone,
      notes: row.notes ?? "",
    }));
  const persist = async (edits: SetupEdits) => {
    if (edits.file) {
      const file = edits.file;
      const ext = file.name.split(".").pop()!.toLowerCase();
      const path = `${provider.data!.profile_id}/avatar-${crypto.randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`;
      const uploaded = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploaded.error) throw uploaded.error;
      const updated = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", provider.data!.profile_id);
      if (updated.error) throw updated.error;
      await upload.mutateAsync({ type: "profile_photo", file });
      await qc.invalidateQueries({ queryKey: ["provider-onboarding-snapshot"] });
      await qc.invalidateQueries({ queryKey: ["my-provider"] });
    }
    if (edits.experience) {
      const current = await snapshot.refetch();
      if (current.error || !current.data) throw current.error ?? new Error("Snapshot unavailable");
      await save.mutateAsync({
        section: "experience",
        payload: mergeExperiencePayload(
          { ...(current.data as SetupSnapshot), needsBabysitting },
          edits.experience,
        ),
      });
    }
    if (edits.references) {
      const current = await refs.refetch();
      if (current.error || !current.data)
        throw current.error ?? new Error("References unavailable");
      await save.mutateAsync({
        section: "references",
        payload: mergeReferencesPayload(normalizedRefs(current.data), edits.references),
      });
    }
    if (edits.personal) await save.mutateAsync({ section: "personal", payload: edits.personal });
    if (edits.rules)
      await replace.mutateAsync({ providerId: provider.data!.id, rules: edits.rules });
    await nav({ to: "/pro" });
  };
  return (
    <ProviderSetupForm
      key={item}
      item={item as Exclude<SetupItem, "subjects">}
      snapshot={{ ...(snapshot.data as SetupSnapshot), needsBabysitting }}
      references={normalizedRefs(refs.data!)}
      rules={availability.data!}
      ageGroups={ages.data!}
      avatarUrl={avatar.data}
      onSave={persist}
      onBack={back}
    />
  );
}
function LiveSubjects({
  providerId,
  services,
  onBack,
}: {
  providerId: string;
  services: import("@/components/provider/GroupedTeachingSetup").SetupTeachingService[];
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const rows = useMyTeachingCapabilities(providerId);
  const subjects = useTeachingSubjects();
  const curricula = useTeachingCurricula();
  const levels = useTeachingLevels();
  const links = useTeachingSubjectServices();
  const save = useSaveTeachingGroup();
  const remove = useRemoveTeachingCapability();
  const queries = [rows, subjects, curricula, levels, links];
  if (queries.some((q) => q.isError))
    return <QueryError onRetry={() => queries.forEach((q) => void q.refetch())} />;
  if (queries.some((q) => !q.isSuccess))
    return (
      <p role="status" className="p-5">
        {t("providerApply.loading")}
      </p>
    );
  return (
    <GroupedTeachingSetup
      services={services}
      subjects={subjects.data!}
      curricula={curricula.data!}
      levels={levels.data!}
      links={links.data!}
      rows={rows.data!}
      onBack={onBack}
      onSave={async (input) => {
        await save.mutateAsync(input);
        onBack();
      }}
      onRemove={async (ids) => {
        const current = await rows.refetch();
        if (current.error || !current.data)
          throw current.error ?? new Error("Capabilities unavailable");
        for (const row of current.data)
          if (ids.includes(row.id) && row.status !== "approved") await remove.mutateAsync(row.id);
      }}
    />
  );
}
