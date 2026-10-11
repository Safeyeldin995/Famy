import { useState } from "react";
import { StickyCta } from "@/components/famio/StickyCta";
import { useProviderSubmittable } from "@/lib/provider/useProviderSubmittable";
import { changesHomeModel, submissionErrors, type SubmitCompletion } from "@/lib/provider/changesHomeModel";
import { Link } from "@tanstack/react-router";
import {
  Baby,
  BookOpen,
  Check,
  Clock,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
  User,
  BriefcaseBusiness,
  IdCard,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useOnboardingSnapshot,
  useMyReferences,
  useMySavedSelections,
  usePhase1Services,
  useSubmitOnboarding,
} from "@/lib/provider/onboarding-queries";
import { useMyTeachingCapabilities } from "@/lib/db/teaching-queries";
import { proPath } from "@/lib/preview/previewPath";
import { QueryError } from "@/components/famio/QueryError";
import { useProviderAvailability } from "@/lib/db/provider-queries";
import { workingHoursState } from "@/lib/provider/setupHelpers";
import { useAvatarUrl } from "@/lib/db/queries";
import { pendingHomeModel, type PendingHomeData } from "@/lib/provider/pendingHomeModel";
import "@/components/famio/providerApply.css";

const icons = {
  basics: MapPin,
  services: BriefcaseBusiness,
  identity: IdCard,
  hours: Clock,
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
  hoursHint = "providerSetup.hoursHint",
  changes,
}: {
  data: PendingHomeData;
  fullName: string;
  avatarUrl?: string;
  hoursHint?: string;
  changes?: { reason?: string | null; completion?: SubmitCompletion; onSubmit: () => Promise<void> };
}) {
  const { t, i18n } = useTranslation();
  const avatar = useAvatarUrl(avatarUrl);
  const firstName = fullName.trim().split(/\s+/)[0];
  const model = pendingHomeModel(data);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const changesModel = changesHomeModel(data, changes?.completion, errors);
  const resubmit = async () => {
    if (!changes || !changesModel.canSubmit || busy) return;
    setBusy(true);
    setFailed(false);
    setErrors({});
    try { await changes.onSubmit(); }
    catch (error) { setFailed(true); setErrors(submissionErrors(error)); }
    finally { setBusy(false); }
  };
  return (
    <section className={`apply-ui apply-content apply-pending-home ${changes ? "apply-changes-home" : ""}`} dir={i18n.dir()}>
      <div className="apply-hello">
        <h1>{t("providerApply.pending.hello", { name: firstName })}</h1>
        <span className="apply-avatar">
          {avatar.data ? <img src={avatar.data} alt={fullName} /> : firstName[0]}
        </span>
      </div>
      {changes ? <div className="apply-note !block" style={{ background: "var(--apply-wait-tint)", color: "var(--apply-wait)" }} role="status">
        <h2 className="text-base font-bold">{t("providerChanges.title")}</h2>
        <p className="mt-2 whitespace-pre-wrap break-words">{changes.reason || t("providerChanges.reasonFallback")}</p>
      </div> : <div className="apply-progcard">
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
      </div>}
      <ul className="apply-list">
        {changes && changesModel.applicationItems.map(({ key, step, done, highlighted }) => {
          const Icon = icons[key];
          return <li key={key}>
            <Link to={proPath("/pro/apply") as "/pro/apply"} search={{ step }} className={`apply-li focus-ring ${highlighted ? "border-s-4 border-destructive" : done ? "apply-done" : ""}`}>
              <span className="apply-tile"><Icon size={20} aria-hidden="true" /></span>
              <span className="apply-task-text"><b>{t(`providerChanges.${key}`)}</b><small>{highlighted ? t("providerChanges.fixRow") : t("providerChanges.editRow")}</small></span>
              {done && !highlighted ? <Check size={18} className="apply-done-check" aria-label={t("common.done")} /> : <span className="apply-tag apply-go">{t("common.edit")}</span>}
            </Link>
          </li>;
        })}
        {model.items.map(({ key, done, next }) => {
          const Icon = icons[key];
          return (
            <li key={key}>
              <Link
                to={proPath("/pro/setup/$item") as "/pro/setup/$item"}
                params={{ item: key }}
                className={`apply-li focus-ring${done ? " apply-done" : next ? " apply-next" : ""}${changes && changesModel.setupItems.find((item) => item.key === key)?.highlighted ? " border-s-4 border-destructive" : ""}`}
              >
                <span className="apply-tile">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="apply-task-text">
                  <b>{t(key === "hours" ? "providerSetup.titles.hours" : `providerApply.${key}`)}</b>
                  <small>{t(key === "hours" ? hoursHint : `providerApply.pending.items.${key}`)}</small>
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
        {!changes && <li>
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
        </li>}
      </ul>
      {changes && <>
        {failed && <p role="alert" className="text-sm text-destructive">{t("providerApply.saveError")} {t(changesModel.hintKey)}</p>}
        <StickyCta disabled={!changesModel.canSubmit || busy} onClick={() => void resubmit()} hint={!changesModel.canSubmit || failed ? t(changesModel.hintKey) : undefined}>{t(busy ? "providerApply.saving" : "providerChanges.resubmit")}</StickyCta>
      </>}
    </section>
  );
}
function LivePendingHome({ providerId, changesRequested, reviewReason }: { providerId: string; changesRequested: boolean; reviewReason?: string | null }) {
  const completion = useProviderSubmittable(providerId, changesRequested);
  const submit = useSubmitOnboarding();
  const snapshot = useOnboardingSnapshot();
  const refs = useMyReferences(providerId);
  const selections = useMySavedSelections(providerId);
  const services = usePhase1Services();
  const subjects = useMyTeachingCapabilities(providerId);
  const availability = useProviderAvailability(providerId);
  const queries = [snapshot, refs, selections, services, subjects, availability, ...(changesRequested ? [completion] : [])];
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
  const hours = workingHoursState(availability.data!, selected);
  return (
    <PendingHomeView
      changes={changesRequested ? { reason: reviewReason, completion: completion.data, onSubmit: async () => { await submit.mutateAsync(); } } : undefined}
      hoursHint={hours.needsNight ? "providerSetup.nightHint" : hours.isDefault ? "providerSetup.defaultHoursHint" : "providerSetup.hoursHint"}
      fullName={data.profile?.full_name ?? ""}
      avatarUrl={data.profile?.avatar_url}
      data={{
        hours: hours.done,
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
  changesRequested = false,
  reviewReason,
}: {
  providerId?: string;
  preview?: boolean;
  changesRequested?: boolean;
  reviewReason?: string | null;
}) {
  const { t } = useTranslation();
  const [previewSubmitted, setPreviewSubmitted] = useState(false);
  return preview ? (
    <PendingHomeView
      changes={changesRequested && !previewSubmitted ? { reason: t("providerChanges.previewReason"), completion: { ok: true, complete: true, errors: {} }, onSubmit: async () => { setPreviewSubmitted(true); } } : undefined}
      fullName="منى عادل"
      hoursHint="providerSetup.defaultHoursHint"
      data={{
        hours: true,
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
    <LivePendingHome providerId={providerId} changesRequested={changesRequested} reviewReason={reviewReason} />
  ) : null;
}
