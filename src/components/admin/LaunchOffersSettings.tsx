import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { ConfirmCatalogButton } from "@/components/admin/CatalogControls";
import { useBillingSettings } from "@/lib/db/settings-queries";
import {
  useFirstLessonGuaranteeSettings,
  useLaunchCommissionSettings,
  useUpdateFirstLessonGuaranteeSettings,
  useUpdateLaunchCommissionSettings,
} from "@/lib/db/launch-offers-queries";

const OFFER_CATEGORIES = ["tutoring", "quran", "music", "babysitting"] as const;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group/settings rounded-2xl border border-border/60 bg-surface p-5 shadow-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="block text-sm font-extrabold">{title}</span>
        <ChevronDown
          aria-hidden
          className="h-5 w-5 shrink-0 transition-transform group-open/settings:rotate-180"
        />
      </summary>
      <div className="mt-4 space-y-3">{children}</div>
    </details>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface-2 px-3 py-2">
      <span className="text-sm font-semibold">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 rounded border-border"
      />
    </label>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label htmlFor={id} className="block space-y-1">
      <span className="text-pro-13 font-semibold">{label}</span>
      <input
        id={id}
        inputMode="decimal"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full rounded-xl border bg-surface px-3 text-pro-14"
      />
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function CategoryPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="space-y-2">
      <legend className="text-pro-13 font-semibold">
        {t("firstLessonGuarantee.settings.categories")}
      </legend>
      <div className="flex flex-wrap gap-2">
        {OFFER_CATEGORIES.map((slug) => {
          const on = value.includes(slug);
          return (
            <button
              key={slug}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((s) => s !== slug) : [...value, slug])}
              className={`focus-ring min-h-10 rounded-full border px-3 text-xs font-bold ${
                on ? "border-brand bg-brand text-brand-foreground" : "border-border bg-surface"
              }`}
            >
              {t(`offerCategories.${slug}`)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const wholeIn = (s: string, min: number, max: number) => {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
};

const percentOrEmpty = (s: string) => {
  if (s.trim() === "") return true;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 50 && Math.round(n * 100) === n * 100;
};

/** «ضمان أول حصة»: on/off, window, monthly cap, sections. */
export function FirstLessonGuaranteeSettingsSection() {
  const { t } = useTranslation();
  const q = useFirstLessonGuaranteeSettings();
  const update = useUpdateFirstLessonGuaranteeSettings();
  const [enabled, setEnabled] = useState(false);
  const [hours, setHours] = useState("");
  const [cap, setCap] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  useEffect(() => {
    if (q.data) {
      setEnabled(q.data.enabled);
      setHours(String(q.data.window_hours));
      setCap(String(q.data.max_per_30_days));
      setCats(q.data.category_slugs);
    }
  }, [q.data]);
  const valid = wholeIn(hours, 1, 168) && wholeIn(cap, 1, 10) && cats.length > 0;

  return (
    <Card title={t("firstLessonGuarantee.settings.title")}>
      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : q.isError ? (
        <AdminQueryError
          message={t("firstLessonGuarantee.settings.loadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : (
        <>
          <Toggle
            label={t("firstLessonGuarantee.settings.enabled")}
            checked={enabled}
            onChange={setEnabled}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              id="guarantee-window-hours"
              label={t("firstLessonGuarantee.settings.windowHours")}
              value={hours}
              onChange={setHours}
            />
            <NumberField
              id="guarantee-max-30"
              label={t("firstLessonGuarantee.settings.maxPer30Days")}
              value={cap}
              onChange={setCap}
            />
          </div>
          <CategoryPicker value={cats} onChange={setCats} />
          <ConfirmCatalogButton
            description={t("adminCatalog.settingsImpact")}
            disabled={!valid || update.isPending}
            onConfirm={() =>
              update.mutate(
                {
                  enabled,
                  window_hours: Number(hours),
                  max_per_30_days: Number(cap),
                  category_slugs: cats,
                },
                {
                  onSuccess: () => toast.success(t("firstLessonGuarantee.settings.saved")),
                  onError: () => toast.error(t("firstLessonGuarantee.settings.saveError")),
                },
              )
            }
          >
            {t("common.save")}
          </ConfirmCatalogButton>
        </>
      )}
    </Card>
  );
}

/** Lower commission for new tutors: on/off, rates, days, start, sections. */
export function LaunchCommissionSettingsSection() {
  const { t } = useTranslation();
  const q = useLaunchCommissionSettings();
  const billing = useBillingSettings();
  const update = useUpdateLaunchCommissionSettings();
  const [enabled, setEnabled] = useState(false);
  const [inPerson, setInPerson] = useState("");
  const [online, setOnline] = useState("");
  const [days, setDays] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  useEffect(() => {
    if (q.data) {
      setEnabled(q.data.enabled);
      setInPerson(q.data.percent_in_person == null ? "" : String(q.data.percent_in_person));
      setOnline(q.data.percent_online == null ? "" : String(q.data.percent_online));
      setDays(String(q.data.duration_days));
      setStartsAt(q.data.starts_at.slice(0, 10));
      setCats(q.data.category_slugs);
    }
  }, [q.data]);
  const startIso = /^\d{4}-\d{2}-\d{2}$/.test(startsAt)
    ? new Date(`${startsAt}T00:00:00+02:00`).toISOString()
    : null;
  const valid =
    percentOrEmpty(inPerson) &&
    percentOrEmpty(online) &&
    wholeIn(days, 1, 365) &&
    !!startIso &&
    cats.length > 0;
  const regularIn = billing.data?.commission_percent ?? null;
  const regularOn = billing.data?.commission_percent_online ?? regularIn;

  return (
    <Card title={t("launchCommission.settings.title")}>
      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : q.isError ? (
        <AdminQueryError
          message={t("launchCommission.settings.loadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : (
        <>
          <Toggle
            label={t("launchCommission.settings.enabled")}
            checked={enabled}
            onChange={setEnabled}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              id="launch-percent-in-person"
              label={t("launchCommission.settings.percentInPerson")}
              value={inPerson}
              onChange={setInPerson}
              hint={
                regularIn != null
                  ? t("launchCommission.settings.regular", { percent: regularIn })
                  : undefined
              }
            />
            <NumberField
              id="launch-percent-online"
              label={t("launchCommission.settings.percentOnline")}
              value={online}
              onChange={setOnline}
              hint={
                regularOn != null
                  ? t("launchCommission.settings.regular", { percent: regularOn })
                  : undefined
              }
            />
            <NumberField
              id="launch-duration-days"
              label={t("launchCommission.settings.durationDays")}
              value={days}
              onChange={setDays}
            />
            <label htmlFor="launch-starts-at" className="block space-y-1">
              <span className="text-pro-13 font-semibold">
                {t("launchCommission.settings.startsAt")}
              </span>
              <input
                id="launch-starts-at"
                type="date"
                dir="ltr"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="min-h-11 w-full rounded-xl border bg-surface px-3 text-pro-14"
              />
            </label>
          </div>
          <CategoryPicker value={cats} onChange={setCats} />
          <ConfirmCatalogButton
            description={t("adminCatalog.settingsImpact")}
            disabled={!valid || update.isPending}
            onConfirm={() =>
              update.mutate(
                {
                  enabled,
                  percent_in_person: inPerson.trim() === "" ? null : Number(inPerson),
                  percent_online: online.trim() === "" ? null : Number(online),
                  duration_days: Number(days),
                  // Keep the exact stored start when the day did not change.
                  starts_at:
                    q.data && q.data.starts_at.slice(0, 10) === startsAt
                      ? q.data.starts_at
                      : startIso!,
                  category_slugs: cats,
                },
                {
                  onSuccess: () => toast.success(t("launchCommission.settings.saved")),
                  onError: () => toast.error(t("launchCommission.settings.saveError")),
                },
              )
            }
          >
            {t("common.save")}
          </ConfirmCatalogButton>
        </>
      )}
    </Card>
  );
}
