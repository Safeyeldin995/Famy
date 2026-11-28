import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Award,
  Baby,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  GraduationCap,
  MapPin,
  MessageSquare,
  Phone,
  User,
} from "lucide-react";
import {
  profileCompletionModel,
  type CompletionKey,
  type ProfileCompletionData,
} from "@/lib/provider/profileCompletionModel";
import { useProPath } from "@/lib/provider/useProPath";

const icons: Record<CompletionKey, typeof User> = {
  photo: User,
  subjects: BookOpen,
  babysitting: Baby,
  hours: Clock,
  about: MessageSquare,
  experience: BriefcaseBusiness,
  education: GraduationCap,
  certificates: Award,
  reference: Phone,
  personal: MapPin,
};

/**
 * «كمل ملفك»: one compact card with a percentage ring. Each row opens its editor,
 * done rows collapse behind one toggle, and the card is gone at 100%.
 */
export function ProfileCompletionCard({
  data,
  only,
}: {
  data: ProfileCompletionData;
  only?: readonly CompletionKey[];
}) {
  const { t, i18n } = useTranslation();
  const proPath = useProPath();
  const [showDone, setShowDone] = useState(false);
  const model = profileCompletionModel(data, only);
  if (model.complete) return null;
  const Chevron = i18n.dir() === "rtl" ? ChevronLeft : ChevronRight;
  const hasRequired = model.items.some((i) => i.required);

  const row = (key: CompletionKey, done: boolean, next: boolean, required: boolean) => {
    const Icon = icons[key];
    return (
      <li key={key}>
        <Link
          to={proPath("/pro/setup/$item") as "/pro/setup/$item"}
          params={{ item: key }}
          className="focus-ring flex min-h-[60px] items-center gap-3 rounded-xl py-2 hover:bg-surface-2"
        >
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
              done
                ? "bg-success/10 text-success"
                : next
                  ? "bg-brand/10 text-brand"
                  : "bg-surface-2 text-muted-foreground"
            }`}
          >
            {done ? <Check size={18} aria-hidden /> : <Icon size={20} aria-hidden />}
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <b className="text-sm">{t(`profileCompletion.items.${key}.title`)}</b>
              {required && !done ? (
                <span className="rounded-full bg-warning/15 px-2 text-xs font-bold text-warning">
                  {t("profileCompletion.requiredTag")}
                </span>
              ) : null}
            </span>
            {!done ? (
              <small className="text-xs text-muted-foreground">
                {t(`profileCompletion.items.${key}.reason`)}
              </small>
            ) : null}
          </span>
          <Chevron
            size={18}
            aria-hidden
            className={next ? "text-brand" : "text-muted-foreground"}
          />
        </Link>
      </li>
    );
  };

  return (
    <section
      className="grid gap-3 rounded-2xl border border-border bg-surface p-4"
      aria-labelledby="profile-completion-title"
    >
      <div className="flex items-center gap-4">
        <svg
          width="58"
          height="58"
          viewBox="0 0 58 58"
          role="img"
          aria-label={t("profileCompletion.ringLabel", { percent: model.percent })}
          className="shrink-0"
        >
          <circle
            cx="29"
            cy="29"
            r="24"
            fill="none"
            stroke="var(--surface-2, #eee)"
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
            fill="currentColor"
            fontSize="13"
            fontWeight="800"
            direction="ltr"
          >
            {model.percent}%
          </text>
        </svg>
        <div className="min-w-0">
          <h2 id="profile-completion-title" className="text-base font-extrabold">
            {t("profileCompletion.title")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t(hasRequired ? "profileCompletion.hint" : "profileCompletion.hintOptional")}
          </p>
        </div>
      </div>
      <ul className="grid border-t border-border pt-1">
        {model.todo.map((item) => row(item.key, false, item.next, item.required))}
      </ul>
      {model.done.length ? (
        <>
          <button
            type="button"
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
            className="focus-ring min-h-11 w-fit text-sm font-bold text-brand"
          >
            {t(showDone ? "profileCompletion.hideDone" : "profileCompletion.doneToggle", {
              count: model.done.length,
            })}
          </button>
          {showDone ? (
            <ul className="grid">
              {model.done.map((item) => row(item.key, true, false, item.required))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
