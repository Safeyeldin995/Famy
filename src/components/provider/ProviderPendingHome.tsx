import { Link } from "@tanstack/react-router";
import {
  Baby,
  BookOpen,
  Check,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
  User,
} from "lucide-react";
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
import { useAvatarUrl } from "@/lib/db/queries";
import { pendingHomeModel, type PendingHomeData } from "@/lib/provider/pendingHomeModel";
import "@/components/famio/providerApply.css";

const icons = {
  photo: User,
  about: MessageSquare,
  babysitting: Baby,
  subjects: BookOpen,
  reference: Phone,
  personal: MapPin,
};

export function PendingHomeView({
  data,
  fullName,
  avatarUrl,
}: {
  data: PendingHomeData;
  fullName: string;
  avatarUrl?: string;
}) {
  const { t, i18n } = useTranslation();
  const avatar = useAvatarUrl(avatarUrl);
  const firstName = fullName.trim().split(/\s+/)[0];
  const model = pendingHomeModel(data);
  return (
    <section className="apply-ui apply-content apply-pending-home" dir={i18n.dir()}>
      <div className="apply-hello">
        <h1>{t("providerApply.pending.hello", { name: firstName })}</h1>
        <span className="apply-avatar">
          {avatar.data ? <img src={avatar.data} alt={fullName} /> : firstName[0]}
        </span>
      </div>
      <div className="apply-progcard">
        <svg
          width="58"
          height="58"
          viewBox="0 0 58 58"
          role="img"
          aria-label={t("providerApply.pending.progress", { done: model.done, total: model.total })}
        >
          <circle
            cx="29"
            cy="29"
            r="24"
            fill="none"
            stroke="rgba(255,255,255,.18)"
            strokeWidth="6"
          />
          <circle
            cx="29"
            cy="29"
            r="24"
            fill="none"
            stroke="var(--brand)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray="150.8"
            strokeDashoffset={model.strokeDashoffset}
            transform="rotate(-90 29 29)"
          />
          <text
            x="29"
            y="34"
            textAnchor="middle"
            fill="#fff"
            fontSize="14"
            fontWeight="800"
            direction="ltr"
          >
            {model.done}/{model.total}
          </text>
        </svg>
        <div>
          <h2>{t(model.titleKey, { remaining: model.remaining })}</h2>
          <p>{t(model.subtitleKey)}</p>
        </div>
      </div>
      <ul className="apply-list">
        {model.items.map(({ key, section, done, next }) => {
          const Icon = icons[key];
          return (
            <li key={key}>
              <Link
                to={proPath("/pro/onboarding") as "/pro/onboarding"}
                search={{ section }}
                className={`apply-li focus-ring${done ? " apply-done" : next ? " apply-next" : ""}`}
              >
                <span className="apply-tile">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="apply-task-text">
                  <b>{t(`providerApply.${key}`)}</b>
                  <small>{t(`providerApply.pending.items.${key}`)}</small>
                </span>
                {done ? (
                  <Check size={18} className="apply-done-check" aria-label={t("common.done")} />
                ) : (
                  <span className={`apply-tag ${next ? "apply-go" : "apply-time"}`}>
                    {t(`providerApply.pending.${next ? "start" : "minute"}`)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
        <li>
          <div className="apply-li apply-waiting">
            <span className="apply-tile">
              <ShieldCheck size={20} aria-hidden="true" />
            </span>
            <span className="apply-task-text">
              <b>{t("providerApply.pending.review")}</b>
              <small>{t("providerApply.pending.reviewHint")}</small>
            </span>
            <span className="apply-tag apply-wait">{t("providerApply.pending.waiting")}</span>
          </div>
        </li>
      </ul>
    </section>
  );
}
function LivePendingHome({ providerId }: { providerId: string }) {
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
    profile?: { avatar_url?: string; full_name?: string };
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
    <PendingHomeView
      fullName={data.profile?.full_name ?? ""}
      avatarUrl={data.profile?.avatar_url}
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
export function ProviderPendingHome({
  providerId,
  preview = false,
}: {
  providerId?: string;
  preview?: boolean;
}) {
  return preview ? (
    <PendingHomeView
      fullName="منى عادل"
      data={{
        photo: true,
        about: false,
        personal: false,
        reference: true,
        babysitting: false,
        needsBabysitting: true,
        subjects: false,
        needsSubjects: true,
      }}
    />
  ) : providerId ? (
    <LivePendingHome providerId={providerId} />
  ) : null;
}
