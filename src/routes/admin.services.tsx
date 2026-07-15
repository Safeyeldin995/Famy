import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Plus, Search } from "lucide-react";
import {
  useAdminServices, useCreateService, useUpdateService, useSetServiceActive,
  useAdminCategories, type AdminServiceInput,
  useFlaggedProviderServices, useClearProviderServiceFlag,
  useAdminRequirements, useCreateRequirement, useUpdateRequirement, useReorderRequirement,
  useAdminRequirementFulfillments, useReviewRequirementFulfillment, useAdminEvidenceSignedUrl,
  type AdminRequirementInput,
} from "@/lib/db/admin-queries";

export const Route = createFileRoute("/admin/services")({ component: AdminServices });

type PricingModel = AdminServiceInput["pricing_model"];
const PRICING_MODELS: PricingModel[] = ["hourly", "fixed", "per_visit"];
const REQUIREMENT_TYPES: AdminRequirementInput["requirement_type"][] = ["equipment", "supplies", "certification", "training", "experience", "other"];
const FULFILLMENT_MODES: AdminRequirementInput["fulfillment_mode"][] = ["customer", "provider", "either"];

type ServiceForm = {
  category_id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  base_price: string;
  duration_min: string;
  pricing_model: PricingModel;
  minimum_price: string;
  maximum_price: string;
  maximum_extras_total: string;
  provider_pricing_allowed: boolean;
};

const EMPTY_FORM: ServiceForm = {
  category_id: "",
  slug: "",
  name_en: "",
  name_ar: "",
  description_en: "",
  description_ar: "",
  base_price: "0",
  duration_min: "60",
  pricing_model: "hourly",
  minimum_price: "",
  maximum_price: "",
  maximum_extras_total: "",
  provider_pricing_allowed: false,
};

function formFromService(s: any): ServiceForm {
  return {
    category_id: s.category_id ?? "",
    slug: s.slug ?? "",
    name_en: s.name_en ?? "",
    name_ar: s.name_ar ?? "",
    description_en: s.description_en ?? "",
    description_ar: s.description_ar ?? "",
    base_price: String(s.base_price ?? 0),
    duration_min: String(s.duration_min ?? 60),
    pricing_model: (s.pricing_model as PricingModel) ?? "hourly",
    minimum_price: s.minimum_price != null ? String(s.minimum_price) : "",
    maximum_price: s.maximum_price != null ? String(s.maximum_price) : "",
    maximum_extras_total: s.maximum_extras_total != null ? String(s.maximum_extras_total) : "",
    provider_pricing_allowed: !!s.provider_pricing_allowed,
  };
}

/** Client-side validation. Uniqueness here is a fast, optimistic check
 * against already-loaded rows — the DB's UNIQUE constraint on slug is the
 * real source of truth and its violation is caught on submit regardless. */
function validate(f: ServiceForm, existingSlugs: Set<string>, editingSlug: string | null, t: (key: string) => string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.name_en.trim()) errors.name_en = t("admin.cancellationReasons.nameEnRequired");
  if (!f.name_ar.trim()) errors.name_ar = t("admin.cancellationReasons.nameArRequired");
  if (!f.category_id) errors.category_id = t("admin.services.categoryRequired");
  const slug = f.slug.trim();
  if (!slug) errors.slug = t("admin.services.slugRequired");
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) errors.slug = t("admin.services.slugFormat");
  else if (slug !== editingSlug && existingSlugs.has(slug)) errors.slug = t("admin.services.slugInUse");
  const price = Number(f.base_price);
  if (!Number.isFinite(price) || price < 0) errors.base_price = t("admin.services.mustBeZeroOrMore");
  const duration = Number(f.duration_min);
  if (!Number.isFinite(duration) || duration <= 0) errors.duration_min = t("admin.services.mustBeGreaterThanZero");
  const min = f.minimum_price.trim() ? Number(f.minimum_price) : null;
  const max = f.maximum_price.trim() ? Number(f.maximum_price) : null;
  if (min != null && (!Number.isFinite(min) || min < 0)) errors.minimum_price = t("admin.services.mustBeZeroOrMore");
  if (max != null && (!Number.isFinite(max) || max < 0)) errors.maximum_price = t("admin.services.mustBeZeroOrMore");
  if (min != null && max != null && max < min) errors.maximum_price = t("admin.services.maxMustBeGteMin");
  if (f.maximum_extras_total.trim()) {
    const extras = Number(f.maximum_extras_total);
    if (!Number.isFinite(extras) || extras < 0) errors.maximum_extras_total = t("admin.services.mustBeZeroOrMore");
  }
  return errors;
}

function toInput(f: ServiceForm): AdminServiceInput {
  return {
    category_id: f.category_id,
    slug: f.slug.trim(),
    name_en: f.name_en.trim(),
    name_ar: f.name_ar.trim(),
    description_en: f.description_en.trim() || null,
    description_ar: f.description_ar.trim() || null,
    base_price: Number(f.base_price),
    duration_min: Number(f.duration_min),
    pricing_model: f.pricing_model,
    is_active: true,
    minimum_price: f.minimum_price.trim() ? Number(f.minimum_price) : null,
    maximum_price: f.maximum_price.trim() ? Number(f.maximum_price) : null,
    maximum_extras_total: f.maximum_extras_total.trim() ? Number(f.maximum_extras_total) : null,
    provider_pricing_allowed: f.provider_pricing_allowed,
  };
}

function dbErrorMessage(e: any, t: (key: string) => string): string {
  if (e?.code === "23505") return t("admin.services.slugInUse");
  return e?.message ?? t("admin.cancellationReasons.genericError");
}

function ServiceFormFields({
  form,
  setForm,
  errors,
  categories,
}: {
  form: ServiceForm;
  setForm: (f: ServiceForm) => void;
  errors: Record<string, string>;
  categories: any[];
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.cancellationReasons.nameEn")}</span>
          <input dir="ltr" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.name_en && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.name_en}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.cancellationReasons.nameAr")}</span>
          <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} dir="rtl"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.name_ar && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.name_ar}</p>}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.services.slug")}</span>
          <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} dir="ltr"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm font-mono" />
          {errors.slug && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.slug}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.services.category")}</span>
          <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
            className="focus-ring mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm">
            <option value="">{t("admin.services.selectCategory")}</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name_en}</option>)}
          </select>
          {errors.category_id && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.category_id}</p>}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.cancellationReasons.descEn")}</span>
          <textarea dir="ltr" value={form.description_en} onChange={(e) => setForm({ ...form, description_en: e.target.value })} rows={2}
            className="mt-1 w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.cancellationReasons.descAr")}</span>
          <textarea value={form.description_ar} onChange={(e) => setForm({ ...form, description_ar: e.target.value })} rows={2} dir="rtl"
            className="mt-1 w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.services.basePrice")}</span>
          <input value={form.base_price} onChange={(e) => setForm({ ...form, base_price: e.target.value })} type="number" min={0} step={1}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.base_price && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.base_price}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.services.durationMin")}</span>
          <input value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} type="number" min={1} step={1}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.duration_min && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.duration_min}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.services.pricingModel")}</span>
          <select value={form.pricing_model} onChange={(e) => setForm({ ...form, pricing_model: e.target.value as PricingModel })}
            className="focus-ring mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm">
            {PRICING_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>

      <div className="rounded-xl border border-border/60 p-3">
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input type="checkbox" checked={form.provider_pricing_allowed} onChange={(e) => setForm({ ...form, provider_pricing_allowed: e.target.checked })} />
          {t("admin.services.allowProviderPricing")}
        </label>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">{t("admin.services.minimumPrice")}</span>
            <input value={form.minimum_price} onChange={(e) => setForm({ ...form, minimum_price: e.target.value })} type="number" min={0} step={1}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
            {errors.minimum_price && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.minimum_price}</p>}
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">{t("admin.services.maximumPrice")}</span>
            <input value={form.maximum_price} onChange={(e) => setForm({ ...form, maximum_price: e.target.value })} type="number" min={0} step={1}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
            {errors.maximum_price && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.maximum_price}</p>}
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">{t("admin.services.maxExtrasTotal")}</span>
            <input value={form.maximum_extras_total} onChange={(e) => setForm({ ...form, maximum_extras_total: e.target.value })} type="number" min={0} step={1}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
            {errors.maximum_extras_total && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.maximum_extras_total}</p>}
          </label>
        </div>
      </div>
    </div>
  );
}

function FlaggedProviders({ serviceId }: { serviceId: string }) {
  const { t } = useTranslation();
  const flaggedQ = useFlaggedProviderServices(serviceId);
  const clearFlag = useClearProviderServiceFlag();
  const rows = flaggedQ.data ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <p className="text-[11px] font-bold text-amber-800">{t("admin.services.flaggedProvidersTitle")}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((r: any) => (
          <li key={r.id} className="flex items-center justify-between text-xs">
            <span>{r.provider?.profile?.full_name ?? r.provider_id.slice(0, 8)} — {r.price_override} EGP</span>
            <button onClick={() => clearFlag.mutate({ id: r.id, serviceId })} className="focus-ring text-[11px] font-bold text-navy">{t("admin.services.clear")}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type RequirementForm = {
  code: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  requirement_type: AdminRequirementInput["requirement_type"];
  required_for_provider_approval: boolean;
  required_during_booking: boolean;
  fulfillment_mode: AdminRequirementInput["fulfillment_mode"];
  provider_extra_fee: string;
  evidence_required: boolean;
};

const EMPTY_REQ_FORM: RequirementForm = {
  code: "",
  name_en: "",
  name_ar: "",
  description_en: "",
  description_ar: "",
  requirement_type: "equipment",
  required_for_provider_approval: false,
  required_during_booking: false,
  fulfillment_mode: "provider",
  provider_extra_fee: "0",
  evidence_required: false,
};

function requirementToInput(f: RequirementForm, serviceId: string): AdminRequirementInput {
  return {
    service_id: serviceId,
    code: f.code.trim(),
    name_en: f.name_en.trim(),
    name_ar: f.name_ar.trim(),
    description_en: f.description_en.trim() || null,
    description_ar: f.description_ar.trim() || null,
    requirement_type: f.requirement_type,
    required_for_provider_approval: f.required_for_provider_approval,
    required_during_booking: f.required_during_booking,
    fulfillment_mode: f.fulfillment_mode,
    provider_extra_fee: Number(f.provider_extra_fee) || 0,
    evidence_required: f.evidence_required,
    is_active: true,
  };
}

function requirementFormFromRow(r: any): RequirementForm {
  return {
    code: r.code ?? "",
    name_en: r.name_en ?? "",
    name_ar: r.name_ar ?? "",
    description_en: r.description_en ?? "",
    description_ar: r.description_ar ?? "",
    requirement_type: r.requirement_type ?? "equipment",
    required_for_provider_approval: !!r.required_for_provider_approval,
    required_during_booking: !!r.required_during_booking,
    fulfillment_mode: r.fulfillment_mode ?? "provider",
    provider_extra_fee: String(r.provider_extra_fee ?? 0),
    evidence_required: !!r.evidence_required,
  };
}

const FULFILLMENT_STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  passed: "bg-mint/20 text-success",
  failed: "bg-coral/10 text-coral",
  waived: "bg-muted text-muted-foreground",
};

function FulfillmentsReview({ requirementId }: { requirementId: string }) {
  const { t } = useTranslation();
  const q = useAdminRequirementFulfillments(requirementId);
  const review = useReviewRequirementFulfillment();
  const signUrl = useAdminEvidenceSignedUrl();
  const rows = q.data ?? [];

  if (rows.length === 0) return <p className="mt-2 text-[11px] text-muted-foreground">{t("admin.services.noDeclarations")}</p>;

  return (
    <ul className="mt-2 space-y-1.5">
      {rows.map((r: any) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-2 text-xs">
          <div className="min-w-0">
            <span className="font-semibold">{r.provider?.profile?.full_name ?? r.provider_id.slice(0, 8)}</span>
            <span className={`ms-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${FULFILLMENT_STATUS_TONE[r.status]}`}>{r.status}</span>
            {r.notes && <p className="text-[11px] text-muted-foreground">{r.notes}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {r.evidence_storage_path && (
              <button
                onClick={async () => window.open(await signUrl.mutateAsync(r.evidence_storage_path), "_blank", "noopener")}
                className="focus-ring rounded-lg border border-border px-2 py-1 text-[11px] font-semibold"
              >{t("admin.services.evidence")}</button>
            )}
            {(["passed", "failed", "waived"] as const).map((s) => (
              <button
                key={s}
                disabled={review.isPending}
                onClick={() => review.mutate({ id: r.id, requirementId, status: s })}
                className={`focus-ring rounded-lg px-2 py-1 text-[11px] font-bold disabled:opacity-50 ${r.status === s ? "bg-navy text-navy-foreground" : "border border-border"}`}
              >{s}</button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function RequirementFormFields({ form, setForm }: { form: RequirementForm; setForm: (f: RequirementForm) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <input dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={t("admin.services.codePlaceholder")}
          className="h-9 rounded-lg border border-border bg-surface px-2 text-xs font-mono" />
        <input dir="ltr" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} placeholder={t("admin.cancellationReasons.nameEn")}
          className="h-9 rounded-lg border border-border bg-surface px-2 text-xs" />
        <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} placeholder={t("admin.cancellationReasons.nameAr")} dir="rtl"
          className="h-9 rounded-lg border border-border bg-surface px-2 text-xs" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select value={form.requirement_type} onChange={(e) => setForm({ ...form, requirement_type: e.target.value as any })}
          className="focus-ring h-9 rounded-lg border border-border bg-surface px-2 text-xs">
          {REQUIREMENT_TYPES.map((rt) => <option key={rt} value={rt}>{rt}</option>)}
        </select>
        <select value={form.fulfillment_mode} onChange={(e) => setForm({ ...form, fulfillment_mode: e.target.value as any })}
          className="focus-ring h-9 rounded-lg border border-border bg-surface px-2 text-xs">
          {FULFILLMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input value={form.provider_extra_fee} onChange={(e) => setForm({ ...form, provider_extra_fee: e.target.value })} type="number" min={0} step={1}
          placeholder={t("admin.services.extraFeePlaceholder")} className="h-9 rounded-lg border border-border bg-surface px-2 text-xs" />
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] font-semibold">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={form.required_for_provider_approval} onChange={(e) => setForm({ ...form, required_for_provider_approval: e.target.checked })} />
          {t("admin.services.requiredForApproval")}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={form.required_during_booking} onChange={(e) => setForm({ ...form, required_during_booking: e.target.checked })} />
          {t("admin.services.requiredDuringBooking")}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={form.evidence_required} onChange={(e) => setForm({ ...form, evidence_required: e.target.checked })} />
          {t("admin.services.evidenceRequired")}
        </label>
      </div>
    </div>
  );
}

function RequirementsPanel({ serviceId }: { serviceId: string }) {
  const { t } = useTranslation();
  const q = useAdminRequirements(serviceId);
  const create = useCreateRequirement();
  const update = useUpdateRequirement();
  const reorder = useReorderRequirement();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<RequirementForm>(EMPTY_REQ_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RequirementForm>(EMPTY_REQ_FORM);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const rows = q.data ?? [];

  const move = (index: number, dir: -1 | 1) => {
    const other = rows[index + dir];
    if (!other) return;
    reorder.mutate({ id: rows[index].id, service_id: serviceId, sort_order: other.sort_order });
    reorder.mutate({ id: other.id, service_id: serviceId, sort_order: rows[index].sort_order });
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t("admin.services.requirements")}</p>
        <button onClick={() => { setCreating((v) => !v); setEditingId(null); }} className="focus-ring text-[11px] font-bold text-navy">
          {creating ? t("common.cancel") : t("admin.services.addRequirement")}
        </button>
      </div>

      {creating && (
        <div className="mt-2 rounded-xl border border-border/60 p-2">
          <RequirementFormFields form={form} setForm={setForm} />
          <button
            onClick={() => create.mutate(
              { ...requirementToInput(form, serviceId), sort_order: rows.length },
              { onSuccess: () => { setCreating(false); setForm(EMPTY_REQ_FORM); toast.success(t("admin.services.requirementAdded")); }, onError: (e: any) => toast.error(dbErrorMessage(e, t)) },
            )}
            disabled={create.isPending || !form.code.trim() || !form.name_en.trim() || !form.name_ar.trim()}
            className="focus-ring mt-2 rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
          >{create.isPending ? t("admin.services.adding") : t("admin.services.add")}</button>
        </div>
      )}

      {rows.length === 0 && !creating && <p className="mt-1 text-[11px] text-muted-foreground">{t("admin.services.noRequirements")}</p>}

      <ul className="mt-2 space-y-1.5">
        {rows.map((r: any, i: number) => (
          <li key={r.id} className="rounded-xl border border-border/60 p-2">
            {editingId === r.id ? (
              <div>
                <RequirementFormFields form={editForm} setForm={setEditForm} />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => update.mutate(
                      { id: r.id, ...requirementToInput(editForm, serviceId), is_active: r.is_active },
                      { onSuccess: () => { setEditingId(null); toast.success(t("admin.services.requirementUpdated")); }, onError: (e: any) => toast.error(dbErrorMessage(e, t)) },
                    )}
                    disabled={update.isPending}
                    className="focus-ring rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
                  >{t("common.save")}</button>
                  <button onClick={() => setEditingId(null)} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-bold">{t("common.cancel")}</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-xs">
                  <span className="font-semibold">{r.name_en}</span>
                  <span className="text-muted-foreground"> / {r.name_ar}</span>
                  {!r.is_active && <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{t("admin.cancellationReasons.inactive")}</span>}
                  <p className="text-[10px] text-muted-foreground">
                    {r.requirement_type} · {r.fulfillment_mode} · {r.provider_extra_fee} EGP
                    {r.required_for_provider_approval ? ` · ${t("admin.services.mandatoryForApproval")}` : ""}
                    {r.required_during_booking ? ` · ${t("admin.services.requiredAtBooking")}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("admin.cancellationReasons.moveUp")} className="focus-ring rounded-lg border border-border px-2 py-1 text-[11px] disabled:opacity-30">↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={t("admin.cancellationReasons.moveDown")} className="focus-ring rounded-lg border border-border px-2 py-1 text-[11px] disabled:opacity-30">↓</button>
                  <button onClick={() => { setReviewingId(reviewingId === r.id ? null : r.id); }} className="focus-ring rounded-lg border border-border px-2 py-1 text-[11px] font-semibold">{t("admin.operations.review")}</button>
                  <button onClick={() => { setEditingId(r.id); setEditForm(requirementFormFromRow(r)); setCreating(false); }}
                    className="focus-ring rounded-lg border border-border px-2 py-1 text-[11px] font-semibold">{t("common.edit")}</button>
                  <button
                    onClick={() => update.mutate({ id: r.id, service_id: serviceId, is_active: !r.is_active })}
                    className={`focus-ring rounded-lg px-2 py-1 text-[11px] font-bold ${r.is_active ? "border border-coral text-coral" : "bg-navy text-navy-foreground"}`}
                  >{r.is_active ? t("admin.cancellationReasons.deactivate") : t("admin.cancellationReasons.activate")}</button>
                </div>
              </div>
            )}
            {reviewingId === r.id && <FulfillmentsReview requirementId={r.id} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdminServices() {
  const { t } = useTranslation();
  const q = useAdminServices();
  const catsQ = useAdminCategories();
  const create = useCreateService();
  const update = useUpdateService();
  const setActive = useSetServiceActive();

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<ServiceForm>(EMPTY_FORM);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ServiceForm>(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const services = q.data ?? [];
  const categories = catsQ.data ?? [];
  const existingSlugs = useMemo(() => new Set(services.map((s: any) => s.slug)), [services]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return services.filter((s: any) => {
      if (categoryFilter !== "all" && s.category?.slug !== categoryFilter) return false;
      if (statusFilter === "active" && !s.is_active) return false;
      if (statusFilter === "inactive" && s.is_active) return false;
      if (!needle) return true;
      return (
        String(s.name_en ?? "").toLowerCase().includes(needle) ||
        String(s.name_ar ?? "").toLowerCase().includes(needle) ||
        String(s.slug ?? "").toLowerCase().includes(needle)
      );
    });
  }, [services, query, categoryFilter, statusFilter]);

  const startCreate = () => {
    setEditingId(null);
    setCreateErrors({});
    setCreateForm({ ...EMPTY_FORM, category_id: categories[0]?.id ?? "" });
    setCreating(true);
  };

  const submitCreate = () => {
    const errors = validate(createForm, existingSlugs, null, t);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;
    create.mutate(toInput(createForm), {
      onSuccess: () => { setCreating(false); toast.success(t("admin.services.created")); },
      onError: (e: any) => toast.error(dbErrorMessage(e, t)),
    });
  };

  const startEdit = (s: any) => {
    setCreating(false);
    setEditErrors({});
    setEditForm(formFromService(s));
    setEditingId(s.id);
  };

  const submitEdit = (s: any) => {
    const errors = validate(editForm, existingSlugs, s.slug, t);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    update.mutate({ id: s.id, ...toInput(editForm), is_active: s.is_active }, {
      onSuccess: () => { setEditingId(null); toast.success(t("admin.services.updated")); },
      onError: (e: any) => toast.error(dbErrorMessage(e, t)),
    });
  };

  return (
    <div className="px-5 py-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("admin.layout.nav.services")}</h1>
          <p className="text-xs text-muted-foreground">{t("admin.services.subtitle")}</p>
        </div>
        <button
          onClick={startCreate}
          disabled={categories.length === 0}
          title={categories.length === 0 ? t("admin.services.categoriesLoading") : undefined}
          className="focus-ring inline-flex items-center gap-1.5 rounded-xl bg-navy px-3 py-2 text-xs font-bold text-navy-foreground disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> {t("admin.services.newService")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.services.searchPlaceholder")}
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
          className="focus-ring h-10 rounded-xl border border-border bg-surface px-3 text-sm">
          <option value="all">{t("admin.services.allCategories")}</option>
          {categories.map((c: any) => <option key={c.id} value={c.slug}>{c.name_en}</option>)}
        </select>
        <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
          {([
            { key: "all" as const, labelKey: "admin.providers.filterAll" },
            { key: "active" as const, labelKey: "admin.customers.filterActive" },
            { key: "inactive" as const, labelKey: "admin.cancellationReasons.inactive" },
          ]).map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`focus-ring rounded-lg px-3 py-1.5 text-xs font-bold ${statusFilter === f.key ? "bg-navy text-navy-foreground" : "text-muted-foreground"}`}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {creating && (
        <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
          <h2 className="text-sm font-extrabold">{t("admin.services.newServiceTitle")}</h2>
          <div className="mt-4">
            <ServiceFormFields form={createForm} setForm={setCreateForm} errors={createErrors} categories={categories} />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={submitCreate} disabled={create.isPending}
              className="focus-ring rounded-lg bg-navy px-4 py-2 text-xs font-bold text-navy-foreground disabled:opacity-50">
              {create.isPending ? t("admin.cancellationReasons.creating") : t("admin.services.createService")}
            </button>
            <button onClick={() => setCreating(false)} className="focus-ring rounded-lg border border-border px-4 py-2 text-xs font-bold">{t("common.cancel")}</button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
        {q.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : q.isError ? (
          <p className="text-sm text-coral">{t("admin.services.loadError")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.services.noResults")}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((s: any) => (
              <li key={s.id} className="rounded-xl border border-border/60 p-3">
                {editingId === s.id ? (
                  <div className="space-y-3">
                    <ServiceFormFields form={editForm} setForm={setEditForm} errors={editErrors} categories={categories} />
                    <div className="flex gap-2">
                      <button onClick={() => submitEdit(s)} disabled={update.isPending}
                        className="focus-ring rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50">
                        {update.isPending ? t("admin.cancellationReasons.saving") : t("common.save")}
                      </button>
                      <button onClick={() => setEditingId(null)} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-bold">{t("common.cancel")}</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-semibold">{s.name_en} <span className="text-muted-foreground">/ {s.name_ar}</span></p>
                        {!s.is_active && (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{t("admin.cancellationReasons.inactive")}</span>
                        )}
                      </div>
                      <p dir="ltr" className="text-start font-mono text-[11px] text-muted-foreground">{s.slug} · {s.category?.name_en ?? "—"}</p>
                      <p className="text-[11px] text-muted-foreground">{s.base_price} EGP · {s.duration_min} min · {s.pricing_model}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button onClick={() => startEdit(s)} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">{t("common.edit")}</button>
                      <button
                        disabled={setActive.isPending}
                        onClick={() => {
                          if (s.is_active) setConfirmDeactivateId(s.id);
                          else setActive.mutate({ id: s.id, active: true }, { onError: (e: any) => toast.error(dbErrorMessage(e, t)) });
                        }}
                        className={`focus-ring rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${s.is_active ? "border border-coral text-coral" : "bg-navy text-navy-foreground"}`}
                      >
                        {s.is_active ? t("admin.cancellationReasons.deactivate") : t("admin.cancellationReasons.activate")}
                      </button>
                    </div>
                  </div>
                )}
                {confirmDeactivateId === s.id && (
                  <div className="mt-3 rounded-xl border border-coral/40 bg-coral/5 p-3">
                    <p className="text-xs font-bold text-coral">{t("admin.services.deactivateConfirmTitle", { name: s.name_en })}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("admin.services.deactivateConfirmBody")}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        disabled={setActive.isPending}
                        onClick={() => setActive.mutate({ id: s.id, active: false }, {
                          onSuccess: () => setConfirmDeactivateId(null),
                          onError: (e: any) => toast.error(dbErrorMessage(e, t)),
                        })}
                        className="focus-ring rounded-lg bg-coral px-3 py-1.5 text-xs font-bold text-coral-foreground disabled:opacity-50"
                      >
                        {setActive.isPending ? t("admin.services.deactivating") : t("admin.cancellationReasons.deactivate")}
                      </button>
                      <button onClick={() => setConfirmDeactivateId(null)} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-bold">{t("common.cancel")}</button>
                    </div>
                  </div>
                )}
                <FlaggedProviders serviceId={s.id} />
                <RequirementsPanel serviceId={s.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
