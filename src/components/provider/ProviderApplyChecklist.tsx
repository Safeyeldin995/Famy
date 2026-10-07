import { Link } from "@tanstack/react-router";
import { Baby, BookOpen, Camera, MapPin, MessageSquare, Phone, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useOnboardingSnapshot,
  useMyReferences,
  useMySavedSelections,
  usePhase1Services,
} from "@/lib/provider/onboarding-queries";
import { useMyTeachingCapabilities } from "@/lib/db/teaching-queries";
import { proPath } from "@/lib/preview/previewPath";
import { QueryError } from "@/components/famio/QueryError";
import "@/components/famio/providerApply.css";

type ChecklistData = {
  photo: boolean;
  about: boolean;
  personal: boolean;
  reference: boolean;
  babysitting: boolean;
  needsBabysitting: boolean;
  subjects: boolean;
  needsSubjects: boolean;
};
const items = [
  { key: "photo", section: "personal", icon: Camera },
  { key: "about", section: "experience", icon: MessageSquare },
  { key: "babysitting", section: "experience", icon: Baby },
  { key: "subjects", section: "services", icon: BookOpen },
  { key: "reference", section: "references", icon: Phone },
  { key: "personal", section: "personal", icon: MapPin },
] as const;
export function applyChecklistItems(data: ChecklistData) {
  return items.filter(
    (item) =>
      !data[item.key] &&
      (item.key !== "babysitting" || data.needsBabysitting) &&
      (item.key !== "subjects" || data.needsSubjects),
  );
}
function ChecklistView({ data }: { data: ChecklistData }) {
  const { t, i18n } = useTranslation();
  return (
    <section className="apply-ui bg-white p-5" dir={i18n.dir()}>
      <div className="mb-4 rounded-[22px] bg-foreground p-[18px] text-white">
        <h2 className="text-[17px] font-extrabold">{t("providerApply.checklist")}</h2>
        <p className="text-[12.5px] opacity-70">{t("providerApply.checklistHint")}</p>
      </div>
      <ul>
        {applyChecklistItems(data).map(({ key, section, icon: Icon }) => (
          <li key={key} className="border-b border-border last:border-0">
            <Link
              to={proPath("/pro/onboarding") as "/pro/onboarding"}
              search={{ section }}
              className="flex min-h-[64px] items-center gap-3 py-3"
            >
              <span className="apply-tile">
                <Icon size={20} />
              </span>
              <span className="flex-1 text-[14.5px] font-bold">{t(`providerApply.${key}`)}</span>
              <span className="rounded-full bg-brand px-3 py-1 text-xs font-bold text-white">
                {t("providerApply.continue")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-3 text-sm">
        <ShieldCheck size={20} className="text-brand" />
        {t("providerApply.reviewing")}
      </p>
    </section>
  );
}
function LiveChecklist({ providerId }: { providerId: string }) {
  const snapshot = useOnboardingSnapshot();
  const refs = useMyReferences(providerId);
  const selections = useMySavedSelections(providerId);
  const services = usePhase1Services();
  const subjects = useMyTeachingCapabilities(providerId);
  const queries = [snapshot, refs, selections, services, subjects];
  if (queries.some((q) => q.isError))
    return <QueryError onRetry={() => queries.forEach((q) => void q.refetch())} />;
  if (queries.some((q) => !q.isSuccess)) return null;
  const data = snapshot.data as {
    profile?: { avatar_url?: string };
    provider?: { bio_en?: string; bio_ar?: string; max_children_per_booking?: number };
    details?: {
      date_of_birth?: string;
      governorate?: string;
      area?: string;
      full_address?: string;
    };
    age_group_capabilities?: unknown[];
  };
  const selected = services.data!.filter((s) =>
    selections.data!.services.some((row) => row.service_id === s.id),
  );
  return (
    <ChecklistView
      data={{
        photo: !!data.profile?.avatar_url,
        about: !!(data.provider?.bio_en || data.provider?.bio_ar),
        personal: !!(
          data.details?.date_of_birth &&
          data.details.governorate &&
          data.details.area &&
          data.details.full_address
        ),
        reference: refs.data!.length > 0,
        needsBabysitting: selected.some((s) => s.category?.slug === "babysitting"),
        babysitting:
          !!data.provider?.max_children_per_booking && !!data.age_group_capabilities?.length,
        needsSubjects: selected.some((s) => s.category?.slug === "tutoring"),
        subjects: selected
          .filter((s) => s.category?.slug === "tutoring")
          .every((s) =>
            subjects.data!.some((row) => row.service_id === s.id && row.status !== "rejected"),
          ),
      }}
    />
  );
}
export function ProviderApplyChecklist({
  providerId,
  preview = false,
}: {
  providerId: string;
  preview?: boolean;
}) {
  return preview ? (
    <ChecklistView
      data={{
        photo: false,
        about: false,
        personal: false,
        reference: false,
        babysitting: false,
        needsBabysitting: true,
        subjects: false,
        needsSubjects: true,
      }}
    />
  ) : (
    <LiveChecklist providerId={providerId} />
  );
}
