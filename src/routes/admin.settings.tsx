import { adminLabel } from "@/components/admin/adminPresentation";
import {
  ConfirmCatalogButton,
  catalogScreen,
  catalogName,
} from "@/components/admin/CatalogControls";
import { adminLocationLabel } from "@/components/admin/adminLocationLabel";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useBillingSettings,
  useUpdateBillingSettings,
  useServiceAreasSettings,
  useUpdateServiceAreasSettings,
  usePlatformContent,
  useUpdatePlatformContent,
  type PlatformContentKey,
  useBookingExpirySettings,
  useUpdateBookingExpirySettings,
} from "@/lib/db/settings-queries";
import {
  useAdminCategories,
  useSetCategoryActive,
  useUpdateCategoryNames,
  useAdminReminderRules,
  useCreateReminderRule,
  useSetReminderRuleActive,
} from "@/lib/db/admin-queries";
import { toast } from "sonner";
import { Save, Check, ChevronDown } from "lucide-react";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

export const Route = createFileRoute("/admin/settings")({ component: AdminSettings });

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group/settings rounded-2xl border border-border/60 bg-surface p-5 shadow-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-sm font-extrabold">{title}</span>
          {subtitle && (
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{subtitle}</span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className="h-5 w-5 shrink-0 transition-transform group-open/settings:rotate-180"
        />
      </summary>
      <div className="mt-4 space-y-3">{children}</div>
    </details>
  );
}

function SaveButton({
  onClick,
  pending,
  saved,
}: {
  onClick: () => void;
  pending: boolean;
  saved: boolean;
}) {
  const { t, i18n } = useTranslation();
  return (
    <ConfirmCatalogButton
      description={t("adminCatalog.settingsImpact")}
      onConfirm={onClick}
      disabled={pending}
      className="focus-ring inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-brand-foreground disabled:opacity-50"
    >
      {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
      {pending
        ? t("admin.cancellationReasons.saving")
        : saved
          ? t("admin.settings.saved")
          : t("common.save")}
    </ConfirmCatalogButton>
  );
}

function useSavedFlash(pending: boolean, succeeded: boolean) {
  const [saved, setSaved] = useState(false);
  const wasPending = useState(() => ({ prev: false }))[0];
  useEffect(() => {
    if (wasPending.prev && !pending && succeeded) {
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 1800);
      return () => clearTimeout(t);
    }
    wasPending.prev = pending;
  }, [pending, succeeded]);
  return saved;
}

function BillingSection() {
  const { t } = useTranslation();
  const q = useBillingSettings();
  const update = useUpdateBillingSettings();
  const [vat, setVat] = useState("");
  const [fee, setFee] = useState("");
  useEffect(() => {
    if (q.data) {
      setVat(String(q.data.vat_percent ?? ""));
      setFee(String(q.data.platform_fee ?? ""));
    }
  }, [q.data]);
  const vatNumber = Number(vat);
  const feeNumber = Number(fee);
  const valid =
    vat.trim() !== "" &&
    fee.trim() !== "" &&
    Number.isFinite(vatNumber) &&
    Number.isFinite(feeNumber) &&
    vatNumber >= 0 &&
    vatNumber <= 100 &&
    feeNumber >= 0;
  const changed =
    !!q.data &&
    (vatNumber !== Number(q.data.vat_percent) || feeNumber !== Number(q.data.platform_fee));
  // VAT and the platform fee are editable; the commission is passed through
  // exactly as stored, so this screen can never change it.
  const save = () =>
    update.mutate(
      {
        vat_percent: vatNumber,
        platform_fee: feeNumber,
        commission_percent: q.data?.commission_percent ?? null,
      },
      {
        onSuccess: () => toast.success(t("admin.settings.saved", "Saved")),
        onError: () => toast.error(t("common.somethingWentWrong")),
      },
    );
  return (
    <SectionCard
      title={t("admin.settings.paymentsTitle")}
      subtitle={t("adminCatalog.billingEditable")}
    >
      {q.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : q.isError ? (
        <AdminQueryError
          message={t("admin.settings.billingLoadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : (
        <div className="space-y-3">
          {(
            [
              ["vatPercent", vat, setVat],
              ["platformFee", fee, setFee],
            ] as const
          ).map(([key, value, set]) => (
            <label key={key} className="block space-y-1">
              <span className="text-pro-13 font-semibold">{t(`admin.settings.${key}`)}</span>
              <input
                id={`billing-${key}`}
                inputMode="decimal"
                dir="ltr"
                value={value}
                onChange={(e) => set(e.target.value)}
                className="min-h-11 w-full rounded-xl border bg-surface px-3 text-pro-14"
              />
            </label>
          ))}
          <div className="flex flex-wrap justify-between gap-3 rounded-xl bg-surface-2 p-3">
            <span>{t("admin.settings.commissionPercent")}</span>
            <bdi dir="ltr">{q.data?.commission_percent ?? "—"}</bdi>
          </div>
          <p className="rounded-xl border p-3 text-pro-13 font-semibold">
            {t("adminCatalog.ownerDecision")}
          </p>
          <ConfirmCatalogButton
            description={t("adminCatalog.billingConfirm")}
            onConfirm={save}
            disabled={!valid || !changed || update.isPending}
          >
            {t("common.save")}
          </ConfirmCatalogButton>
        </div>
      )}
    </SectionCard>
  );
}

function BookingExpirySection() {
  const { t, i18n } = useTranslation();
  const q = useBookingExpirySettings();
  const update = useUpdateBookingExpirySettings();
  const [ttl, setTtl] = useState("");
  const [minBefore, setMinBefore] = useState("");
  const saved = useSavedFlash(update.isPending, update.isSuccess);
  const initialized = useState(() => ({ done: false }))[0];
  useEffect(() => {
    if (q.data && !initialized.done) {
      initialized.done = true;
      setTtl(String(q.data.pending_ttl_hours));
      setMinBefore(String(q.data.min_hours_before_start));
    }
  }, [q.data, initialized]);

  if (q.isLoading) {
    return (
      <SectionCard
        title={t("admin.settings.bookingExpiryTitle")}
        subtitle={t("admin.settings.bookingExpirySubtitle")}
      >
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
      </SectionCard>
    );
  }
  if (q.isError) {
    return (
      <SectionCard
        title={t("admin.settings.bookingExpiryTitle")}
        subtitle={t("admin.settings.bookingExpirySubtitle")}
      >
        <AdminQueryError
          compact
          message={t("admin.settings.bookingExpiryLoadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={t("admin.settings.bookingExpiryTitle")}
      subtitle={t("admin.settings.bookingExpirySubtitle")}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">
            {t("admin.settings.pendingTtlHours")}
          </span>
          <input
            value={ttl}
            onChange={(e) => setTtl(e.target.value)}
            type="number"
            min={0}
            step={1}
            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">
            {t("admin.settings.minHoursBeforeStart")}
          </span>
          <input
            value={minBefore}
            onChange={(e) => setMinBefore(e.target.value)}
            type="number"
            min={0}
            step={1}
            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm"
          />
        </label>
      </div>
      <SaveButton
        pending={update.isPending}
        saved={saved}
        onClick={() =>
          update.mutate(
            {
              pending_ttl_hours: Math.max(0, Number(ttl) || 0),
              min_hours_before_start: Math.max(0, Number(minBefore) || 0),
            },
            {
              onError: (e: any) =>
                toast.error(e?.message ?? t("admin.settings.bookingExpirySaveError")),
            },
          )
        }
      />
    </SectionCard>
  );
}

function CategoriesSection() {
  const { t, i18n } = useTranslation();
  const q = useAdminCategories();
  const setActive = useSetCategoryActive();
  const updateNames = useUpdateCategoryNames();
  const [editing, setEditing] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");

  return (
    <SectionCard
      title={t("admin.settings.categoriesTitle")}
      subtitle={t("admin.settings.categoriesSubtitle")}
    >
      {q.isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
      ) : q.isError ? (
        <AdminQueryError
          compact
          message={t("admin.settings.categoriesLoadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : (
        <ul className="space-y-2">
          {(q.data ?? []).map((c: any) => (
            <li key={c.id} className="rounded-xl border border-border/60 p-3">
              {editing === c.id ? (
                <div className="space-y-2">
                  <input
                    dir="ltr"
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    placeholder={t("admin.cancellationReasons.nameEn")}
                    className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
                  />
                  <input
                    value={nameAr}
                    onChange={(e) => setNameAr(e.target.value)}
                    placeholder={t("admin.cancellationReasons.nameAr")}
                    dir="rtl"
                    className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <ConfirmCatalogButton
                      description={t("adminCatalog.settingsImpact")}
                      disabled={updateNames.isPending}
                      onConfirm={() =>
                        updateNames.mutate(
                          { id: c.id, name_en: nameEn, name_ar: nameAr },
                          {
                            onSuccess: () => setEditing(null),
                            onError: (e: any) =>
                              toast.error(e?.message ?? t("admin.settings.categorySaveError")),
                          },
                        )
                      }
                      className="focus-ring rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground disabled:opacity-50"
                    >
                      {updateNames.isPending
                        ? t("admin.cancellationReasons.saving")
                        : t("common.save")}
                    </ConfirmCatalogButton>
                    <button
                      onClick={() => setEditing(null)}
                      className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-bold"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{catalogName(c, i18n.language)}</p>
                    <p className="text-start text-xs text-muted-foreground">
                      {adminLabel(c.slug, i18n.language)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => {
                        setEditing(c.id);
                        setNameEn(c.name_en);
                        setNameAr(c.name_ar);
                      }}
                      className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-semibold"
                    >
                      {t("common.edit")}
                    </button>
                    <ConfirmCatalogButton
                      description={t("adminCatalog.settingsImpact")}
                      disabled={setActive.isPending}
                      onConfirm={() =>
                        setActive.mutate(
                          { id: c.id, active: !c.is_active },
                          {
                            onError: (e: any) =>
                              toast.error(e?.message ?? t("admin.settings.categoryUpdateError")),
                          },
                        )
                      }
                      className={`focus-ring rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${c.is_active ? "border border-coral text-coral" : "bg-brand text-brand-foreground"}`}
                    >
                      {c.is_active ? t("admin.settings.disable") : t("admin.settings.enable")}
                    </ConfirmCatalogButton>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ServiceAreasSection() {
  const { t, i18n } = useTranslation();
  const q = useServiceAreasSettings();
  const update = useUpdateServiceAreasSettings();
  const [areas, setAreas] = useState<{ name: string; enabled: boolean }[]>([]);
  const saved = useSavedFlash(update.isPending, update.isSuccess);
  // Init once — see BillingSection for why re-syncing on every q.data change
  // is unsafe (would silently revert an in-flight toggle).
  const initialized = useState(() => ({ done: false }))[0];
  useEffect(() => {
    if (q.data && !initialized.done) {
      initialized.done = true;
      setAreas(q.data);
    }
  }, [q.data, initialized]);

  const toggle = (name: string) => {
    const previous = areas;
    const next = areas.map((a) => (a.name === name ? { ...a, enabled: !a.enabled } : a));
    setAreas(next);
    update.mutate(next, {
      onError: (e: any) => {
        setAreas(previous);
        void q.refetch();
        toast.error(e?.message ?? t("admin.settings.serviceAreaError"));
      },
    });
  };

  return (
    <SectionCard
      title={t("admin.settings.serviceAreasTitle")}
      subtitle={t("admin.settings.serviceAreasSubtitle")}
    >
      {q.isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
      ) : q.isError ? (
        <AdminQueryError
          compact
          message={t("admin.settings.serviceAreasLoadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : (
        <ul className="space-y-2">
          {areas.map((a) => (
            <li
              key={a.name}
              className="flex flex-wrap items-center justify-between rounded-xl border border-border/60 p-3"
            >
              <span className="text-sm font-semibold">
                {adminLocationLabel(a.name, i18n.language, t)}
              </span>
              <ConfirmCatalogButton
                description={t("adminCatalog.settingsImpact")}
                disabled={update.isPending}
                onConfirm={() => toggle(a.name)}
                className={`focus-ring rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${a.enabled ? "border border-coral text-coral" : "bg-brand text-brand-foreground"}`}
              >
                {a.enabled ? t("admin.settings.disable") : t("admin.settings.enable")}
              </ConfirmCatalogButton>
            </li>
          ))}
        </ul>
      )}
      {saved && <p className="text-xs font-semibold text-success">{t("admin.settings.saved")}</p>}
    </SectionCard>
  );
}

function ReminderRulesSection() {
  const { t, i18n } = useTranslation();
  const q = useAdminReminderRules();
  const create = useCreateReminderRule();
  const setActive = useSetReminderRuleActive();
  const [leadMinutes, setLeadMinutes] = useState("");

  const handleAdd = () => {
    const n = Number(leadMinutes);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error(t("admin.settings.leadTimeError"));
      return;
    }
    create.mutate(n, {
      onSuccess: () => setLeadMinutes(""),
      onError: (e: any) => toast.error(e?.message ?? t("admin.settings.reminderAddError")),
    });
  };

  return (
    <SectionCard
      title={t("admin.settings.remindersTitle")}
      subtitle={t("admin.settings.remindersSubtitle")}
    >
      {q.isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
      ) : q.isError ? (
        <AdminQueryError
          compact
          message={t("admin.settings.remindersLoadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.settings.noReminderRules")}</p>
      ) : (
        <ul className="space-y-2">
          {q.data!.map((r: any) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between rounded-xl border border-border/60 p-3"
            >
              <span className="text-sm font-semibold">
                {t("admin.settings.minutesBefore", { count: r.lead_minutes })}
              </span>
              <ConfirmCatalogButton
                description={t("adminCatalog.settingsImpact")}
                disabled={setActive.isPending}
                onConfirm={() =>
                  setActive.mutate(
                    { id: r.id, active: !r.is_active },
                    {
                      onError: (e: any) =>
                        toast.error(e?.message ?? t("admin.settings.reminderUpdateError")),
                    },
                  )
                }
                className={`focus-ring rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${r.is_active ? "border border-coral text-coral" : "bg-brand text-brand-foreground"}`}
              >
                {r.is_active ? t("admin.settings.disable") : t("admin.settings.enable")}
              </ConfirmCatalogButton>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          value={leadMinutes}
          onChange={(e) => setLeadMinutes(e.target.value)}
          type="number"
          min={1}
          placeholder={t("admin.settings.minutesBeforeStart")}
          className="h-9 w-40 rounded-lg border border-border bg-surface px-2 text-xs"
        />
        <ConfirmCatalogButton
          description={t("adminCatalog.settingsImpact")}
          onConfirm={handleAdd}
          disabled={create.isPending}
          className="focus-ring rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground disabled:opacity-50"
        >
          {t("admin.settings.addRule")}
        </ConfirmCatalogButton>
      </div>
    </SectionCard>
  );
}

const CONTENT_KEYS: { key: PlatformContentKey; labelKey: string }[] = [
  { key: "terms", labelKey: "admin.settings.contentTerms" },
  { key: "privacy", labelKey: "admin.settings.contentPrivacy" },
  { key: "about", labelKey: "admin.settings.contentAbout" },
  { key: "contact", labelKey: "admin.settings.contentContact" },
];

function ContentEditor({ contentKey, label }: { contentKey: PlatformContentKey; label: string }) {
  const { t, i18n } = useTranslation();
  const q = usePlatformContent(contentKey);
  const update = useUpdatePlatformContent();
  const [en, setEn] = useState("");
  const [ar, setAr] = useState("");
  const saved = useSavedFlash(update.isPending, update.isSuccess);
  // Init once — see BillingSection for why re-syncing on every q.data change
  // is unsafe (would silently discard in-progress edits).
  const initialized = useState(() => ({ done: false }))[0];
  useEffect(() => {
    if (q.data && !initialized.done) {
      initialized.done = true;
      setEn(q.data.body_en);
      setAr(q.data.body_ar);
    }
  }, [q.data, initialized]);

  return (
    <div className="rounded-xl border border-border/60 p-3">
      <p className="text-sm font-semibold">{label}</p>
      {q.isLoading ? (
        <div className="mt-2 h-24 animate-pulse rounded-lg bg-muted" />
      ) : q.isError ? (
        <AdminQueryError
          compact
          message={t("admin.settings.contentLoadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : (
        <>
          <textarea
            dir="ltr"
            value={en}
            onChange={(e) => setEn(e.target.value)}
            rows={4}
            placeholder={t("admin.settings.englishContentPlaceholder")}
            className="mt-2 w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs"
          />
          <textarea
            value={ar}
            onChange={(e) => setAr(e.target.value)}
            rows={4}
            dir="rtl"
            placeholder={t("admin.settings.arabicContentPlaceholder")}
            className="mt-2 w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs"
          />
        </>
      )}
      {!q.isError && (
        <div className="mt-2">
          <SaveButton
            pending={update.isPending}
            saved={saved}
            onClick={() =>
              update.mutate(
                { key: contentKey, body_en: en, body_ar: ar },
                {
                  onError: (e: any) =>
                    toast.error(e?.message ?? t("admin.settings.contentSaveError")),
                },
              )
            }
          />
        </div>
      )}
    </div>
  );
}

function PlatformContentSection() {
  const { t, i18n } = useTranslation();
  return (
    <SectionCard
      title={t("admin.settings.platformContentTitle")}
      subtitle={t("admin.settings.platformContentSubtitle")}
    >
      <div className="space-y-3">
        {CONTENT_KEYS.map((c) => (
          <ContentEditor key={c.key} contentKey={c.key} label={t(c.labelKey)} />
        ))}
      </div>
    </SectionCard>
  );
}

function AdminSettings() {
  const { t, i18n } = useTranslation();
  return (
    <div className={catalogScreen}>
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          {t("admin.layout.nav.settings")}
        </h1>
        <p className="text-xs text-muted-foreground">{t("admin.settings.subtitle")}</p>
      </div>
      <BillingSection />
      <BookingExpirySection />
      <CategoriesSection />
      <ServiceAreasSection />
      <ReminderRulesSection />
      <PlatformContentSection />
    </div>
  );
}
