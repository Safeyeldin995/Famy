import { catalogScreen, catalogName, catalogDate } from "@/components/admin/CatalogControls";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Plus, Search, Copy, Tag } from "lucide-react";
import {
  useAdminPromoCodes,
  useCreatePromoCode,
  useUpdatePromoCode,
  useSetPromoCodeActive,
  usePromoCodeScope,
  useAllPromoCodeScopes,
  useSetPromoCodeScope,
  type DiscountType,
  type ApplicableMode,
  type ApplicableScope,
  type PromoCodeInput,
  type PromoCodeRow,
} from "@/lib/db/promo-codes-queries";
import { useAdminCategories, useAdminServices } from "@/lib/db/admin-queries";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

export const Route = createFileRoute("/admin/promo-codes")({ component: AdminPromoCodes });

type PromoForm = {
  code: string;
  description_en: string;
  description_ar: string;
  discount_type: DiscountType;
  discount_value: string;
  maximum_discount: string;
  minimum_booking_amount: string;
  starts_at: string;
  expires_at: string;
  total_usage_limit: string;
  usage_limit_per_customer: string;
  first_booking_only: boolean;
  applicable_scope: ApplicableScope;
  applicable_mode: ApplicableMode;
  is_featured: boolean;
};

type ScopeIds = { categoryIds: string[]; serviceIds: string[] };

/** Online-only promos can only target catalog entries that allow online lessons. */
function fitsMode(row: { online_allowed?: boolean | null }, mode: ApplicableMode): boolean {
  return mode !== "online" || !!row.online_allowed;
}

const MODE_LABEL_KEYS: Record<ApplicableMode, string> = {
  all: "admin.promoCodes.modeAll",
  online: "admin.promoCodes.modeOnline",
  in_person: "admin.promoCodes.modeInPerson",
};

const EMPTY_FORM: PromoForm = {
  code: "",
  description_en: "",
  description_ar: "",
  discount_type: "fixed",
  discount_value: "",
  maximum_discount: "",
  minimum_booking_amount: "0",
  starts_at: "",
  expires_at: "",
  total_usage_limit: "",
  usage_limit_per_customer: "1",
  first_booking_only: false,
  applicable_scope: "all",
  applicable_mode: "all",
  is_featured: false,
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formFromRow(p: PromoCodeRow): PromoForm {
  return {
    code: p.code,
    description_en: p.description_en ?? "",
    description_ar: p.description_ar ?? "",
    discount_type: p.discount_type,
    discount_value: String(p.discount_value),
    maximum_discount: p.maximum_discount != null ? String(p.maximum_discount) : "",
    minimum_booking_amount: String(p.minimum_booking_amount),
    starts_at: toDatetimeLocal(p.starts_at),
    expires_at: toDatetimeLocal(p.expires_at),
    total_usage_limit: p.total_usage_limit != null ? String(p.total_usage_limit) : "",
    usage_limit_per_customer:
      p.usage_limit_per_customer != null ? String(p.usage_limit_per_customer) : "",
    first_booking_only: p.first_booking_only,
    applicable_scope: p.applicable_scope,
    applicable_mode: p.applicable_mode ?? "all",
    is_featured: p.is_featured,
  };
}

function validate(
  f: PromoForm,
  t: (key: string) => string,
  scope?: { categoryIds: string[]; serviceIds: string[] },
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.code.trim()) errors.code = t("admin.promoCodes.codeRequired");
  else if (!/^[a-zA-Z0-9_-]+$/.test(f.code.trim())) errors.code = t("admin.promoCodes.codeFormat");
  const value = Number(f.discount_value);
  if (!Number.isFinite(value) || value <= 0)
    errors.discount_value = t("admin.services.mustBeGreaterThanZero");
  else if (f.discount_type === "percentage" && value > 100)
    errors.discount_value = t("admin.promoCodes.percentageMax");
  if (f.maximum_discount.trim()) {
    const max = Number(f.maximum_discount);
    if (!Number.isFinite(max) || max < 0)
      errors.maximum_discount = t("admin.services.mustBeZeroOrMore");
  }
  const min = Number(f.minimum_booking_amount);
  if (!Number.isFinite(min) || min < 0)
    errors.minimum_booking_amount = t("admin.services.mustBeZeroOrMore");
  if (f.total_usage_limit.trim()) {
    const lim = Number(f.total_usage_limit);
    if (!Number.isInteger(lim) || lim <= 0)
      errors.total_usage_limit = t("admin.promoCodes.mustBeWholeNumber");
  }
  if (f.usage_limit_per_customer.trim()) {
    const lim = Number(f.usage_limit_per_customer);
    if (!Number.isInteger(lim) || lim <= 0)
      errors.usage_limit_per_customer = t("admin.promoCodes.mustBeWholeNumber");
  }
  if (f.starts_at && f.expires_at && new Date(f.expires_at) <= new Date(f.starts_at)) {
    errors.expires_at = t("admin.promoCodes.expiresAfterStart");
  }
  if (f.applicable_scope === "categories" && scope && scope.categoryIds.length === 0) {
    errors.scope = t("admin.promoCodes.scopeCategoriesRequired");
  }
  if (f.applicable_scope === "services" && scope && scope.serviceIds.length === 0) {
    errors.scope = t("admin.promoCodes.scopeServicesRequired");
  }
  return errors;
}

function toInput(f: PromoForm, is_active: boolean): PromoCodeInput {
  return {
    code: f.code.trim().toUpperCase(),
    description_en: f.description_en.trim() || null,
    description_ar: f.description_ar.trim() || null,
    discount_type: f.discount_type,
    discount_value: Number(f.discount_value),
    maximum_discount: f.maximum_discount.trim() ? Number(f.maximum_discount) : null,
    minimum_booking_amount: f.minimum_booking_amount.trim() ? Number(f.minimum_booking_amount) : 0,
    starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null,
    expires_at: f.expires_at ? new Date(f.expires_at).toISOString() : null,
    total_usage_limit: f.total_usage_limit.trim() ? Number(f.total_usage_limit) : null,
    usage_limit_per_customer: f.usage_limit_per_customer.trim()
      ? Number(f.usage_limit_per_customer)
      : null,
    first_booking_only: f.first_booking_only,
    applicable_scope: f.applicable_scope,
    applicable_mode: f.applicable_mode,
    is_active,
    is_featured: f.is_featured,
  };
}

function dbErrorMessage(e: any, t: (key: string) => string): string {
  if (e?.code === "23505") return t("admin.promoCodes.codeExists");
  if (e?.code === "23514") return e?.message ?? t("admin.cancellationReasons.valueNotAllowed");
  return e?.message ?? t("admin.cancellationReasons.genericError");
}

function PromoFormFields({
  form,
  setForm,
  errors,
  categories,
  services,
  scope,
  setScope,
  lockCode,
}: {
  form: PromoForm;
  setForm: (f: PromoForm) => void;
  errors: Record<string, string>;
  categories: any[];
  services: any[];
  scope: ScopeIds;
  setScope: (s: ScopeIds) => void;
  lockCode?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const mode = form.applicable_mode;

  // Only active entries that fit the booking type are offered; anything
  // already selected stays visible so the admin can see and remove it.
  const visibleCategories = categories.filter(
    (c: any) => scope.categoryIds.includes(c.id) || (c.is_active && fitsMode(c, mode)),
  );
  const serviceGroups = useMemo(() => {
    const categoryOrder = new Map<string, number>(
      categories.map((c: any, i: number) => [c.id as string, i]),
    );
    const groups = new Map<string, { key: string; category: any; items: any[] }>();
    for (const s of services) {
      if (!scope.serviceIds.includes(s.id) && !(s.is_active && fitsMode(s, mode))) continue;
      const key = s.category_id ?? "";
      let g = groups.get(key);
      if (!g) {
        g = { key, category: s.category, items: [] };
        groups.set(key, g);
      }
      g.items.push(s);
    }
    return [...groups.values()].sort(
      (a, b) => (categoryOrder.get(a.key) ?? 999) - (categoryOrder.get(b.key) ?? 999),
    );
  }, [services, categories, scope.serviceIds, mode]);

  const changeMode = (next: ApplicableMode) => {
    setForm({ ...form, applicable_mode: next });
    const serviceById = new Map(services.map((s: any) => [s.id, s]));
    const categoryById = new Map(categories.map((c: any) => [c.id, c]));
    const serviceIds = scope.serviceIds.filter((id) => {
      const row = serviceById.get(id);
      return !row || fitsMode(row, next);
    });
    const categoryIds = scope.categoryIds.filter((id) => {
      const row = categoryById.get(id);
      return !row || fitsMode(row, next);
    });
    if (
      serviceIds.length !== scope.serviceIds.length ||
      categoryIds.length !== scope.categoryIds.length
    ) {
      setScope({ categoryIds, serviceIds });
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">
            {t("admin.cancellationReasons.code")}
          </span>
          <input
            value={form.code}
            disabled={lockCode}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            dir="ltr"
            placeholder={t("admin.promoCodes.codePlaceholder")}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm font-mono disabled:opacity-60"
          />
          {errors.code && <p className="mt-1 text-xs font-semibold text-coral">{errors.code}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">
            {t("admin.promoCodes.scope")}
          </span>
          <select
            value={form.applicable_scope}
            onChange={(e) =>
              setForm({ ...form, applicable_scope: e.target.value as ApplicableScope })
            }
            className="focus-ring mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
          >
            <option value="all">{t("admin.promoCodes.scopeAll")}</option>
            <option value="categories">{t("admin.promoCodes.scopeCategories")}</option>
            <option value="services">{t("admin.promoCodes.scopeServices")}</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">
            {t("admin.promoCodes.mode")}
          </span>
          <select
            value={mode}
            onChange={(e) => changeMode(e.target.value as ApplicableMode)}
            className="focus-ring mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
          >
            <option value="all">{t("admin.promoCodes.modeAll")}</option>
            <option value="online">{t("admin.promoCodes.modeOnline")}</option>
            <option value="in_person">{t("admin.promoCodes.modeInPerson")}</option>
          </select>
        </label>
      </div>

      <details
        className="rounded-xl border p-3"
        open={form.applicable_scope !== "all" || undefined}
      >
        <summary className="cursor-pointer font-bold">{t("adminCatalog.promoAudience")}</summary>
        {errors.scope ? (
          <p className="mt-2 text-xs font-semibold text-coral">{errors.scope}</p>
        ) : null}
        {form.applicable_scope === "categories" && (
          <div className="rounded-lg border border-border/60 bg-surface-2 p-3">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("admin.promoCodes.categories")}
            </span>
            {visibleCategories.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("admin.promoCodes.noCategoriesForMode")}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {visibleCategories.map((c: any) => {
                const checked = scope.categoryIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${checked ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      className="hidden"
                      onChange={() =>
                        setScope({
                          ...scope,
                          categoryIds: checked
                            ? scope.categoryIds.filter((id) => id !== c.id)
                            : [...scope.categoryIds, c.id],
                        })
                      }
                    />
                    {catalogName(c, i18n.language)}
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {form.applicable_scope === "services" && (
          <div className="rounded-lg border border-border/60 bg-surface-2 p-3">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("admin.layout.nav.services")}
            </span>
            {serviceGroups.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("admin.promoCodes.noServicesForMode")}
              </p>
            ) : null}
            {serviceGroups.map((group) => (
              <div key={group.key} className="mt-3">
                <p className="text-xs font-bold">
                  {group.category ? catalogName(group.category, i18n.language) : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {group.items.map((s: any) => {
                    const checked = scope.serviceIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${checked ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          className="hidden"
                          onChange={() =>
                            setScope({
                              ...scope,
                              serviceIds: checked
                                ? scope.serviceIds.filter((id) => id !== s.id)
                                : [...scope.serviceIds, s.id],
                            })
                          }
                        />
                        {catalogName(s, i18n.language)}
                        {s.online_allowed && mode !== "in_person" ? (
                          <span className="rounded-full bg-brand/10 px-1.5 text-xs font-bold text-brand">
                            {t("admin.promoCodes.onlineBadge")}
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("admin.cancellationReasons.descEn")}
            </span>
            <textarea
              dir="ltr"
              value={form.description_en}
              onChange={(e) => setForm({ ...form, description_en: e.target.value })}
              rows={2}
              className="mt-1 w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("admin.cancellationReasons.descAr")}
            </span>
            <textarea
              value={form.description_ar}
              onChange={(e) => setForm({ ...form, description_ar: e.target.value })}
              rows={2}
              dir="rtl"
              className="mt-1 w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs"
            />
          </label>
        </div>
      </details>
      <h3 className="font-bold">{t("adminCatalog.promoValue")}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">
            {t("admin.promoCodes.discountType")}
          </span>
          <select
            value={form.discount_type}
            onChange={(e) => setForm({ ...form, discount_type: e.target.value as DiscountType })}
            className="focus-ring mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
          >
            <option value="fixed">{t("admin.promoCodes.fixedEgp")}</option>
            <option value="percentage">{t("admin.promoCodes.percentage")}</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">
            {form.discount_type === "percentage"
              ? t("admin.promoCodes.discountPercent")
              : t("admin.promoCodes.discountEgp")}
          </span>
          <input
            value={form.discount_value}
            onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
            type="number"
            min={0}
            step={1}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
          />
          {errors.discount_value && (
            <p className="mt-1 text-xs font-semibold text-coral">{errors.discount_value}</p>
          )}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">
            {t("admin.promoCodes.maxDiscount")}
          </span>
          <input
            value={form.maximum_discount}
            onChange={(e) => setForm({ ...form, maximum_discount: e.target.value })}
            type="number"
            min={0}
            step={1}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
          />
          {errors.maximum_discount && (
            <p className="mt-1 text-xs font-semibold text-coral">{errors.maximum_discount}</p>
          )}
        </label>
      </div>

      <details
        className="rounded-xl border p-3"
        open={
          Object.keys(errors).some((key) =>
            [
              "minimum_booking_amount",
              "total_usage_limit",
              "usage_limit_per_customer",
              "expires_at",
            ].includes(key),
          ) || undefined
        }
      >
        <summary className="cursor-pointer font-bold">{t("adminCatalog.promoLimits")}</summary>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("admin.promoCodes.minBookingAmount")}
            </span>
            <input
              value={form.minimum_booking_amount}
              onChange={(e) => setForm({ ...form, minimum_booking_amount: e.target.value })}
              type="number"
              min={0}
              step={1}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
            />
            {errors.minimum_booking_amount && (
              <p className="mt-1 text-xs font-semibold text-coral">
                {errors.minimum_booking_amount}
              </p>
            )}
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("admin.promoCodes.totalUsageLimit")}
            </span>
            <input
              value={form.total_usage_limit}
              onChange={(e) => setForm({ ...form, total_usage_limit: e.target.value })}
              type="number"
              min={1}
              step={1}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
            />
            {errors.total_usage_limit && (
              <p className="mt-1 text-xs font-semibold text-coral">{errors.total_usage_limit}</p>
            )}
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("admin.promoCodes.perCustomerLimit")}
            </span>
            <input
              value={form.usage_limit_per_customer}
              onChange={(e) => setForm({ ...form, usage_limit_per_customer: e.target.value })}
              type="number"
              min={1}
              step={1}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
            />
            {errors.usage_limit_per_customer && (
              <p className="mt-1 text-xs font-semibold text-coral">
                {errors.usage_limit_per_customer}
              </p>
            )}
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 items-end gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("admin.promoCodes.startsAt")}
            </span>
            <input
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              type="datetime-local"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("admin.promoCodes.expiresAt")}
            </span>
            <input
              value={form.expires_at}
              onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
              type="datetime-local"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
            />
            {errors.expires_at && (
              <p className="mt-1 text-xs font-semibold text-coral">{errors.expires_at}</p>
            )}
          </label>
          <div className="space-y-2">
            <label className="flex h-9 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={form.first_booking_only}
                onChange={(e) => setForm({ ...form, first_booking_only: e.target.checked })}
              />
              <span className="text-xs font-semibold text-muted-foreground">
                {t("admin.promoCodes.firstBookingOnly")}
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_featured}
                onChange={(e) => setForm({ ...form, is_featured: e.target.checked })}
              />
              <span className="text-xs font-semibold text-muted-foreground">
                {t("admin.promoCodes.featured")}
              </span>
            </label>
          </div>
        </div>
      </details>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  pending,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="promo-confirm-title"
        className="w-full max-w-sm rounded-2xl bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="promo-confirm-title" className="text-base font-extrabold">
          {title}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{body}</p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="focus-ring h-11 flex-1 rounded-xl border border-border text-sm font-bold"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="focus-ring h-11 flex-1 rounded-xl bg-brand text-sm font-bold text-brand-foreground disabled:opacity-50"
          >
            {pending ? t("admin.cancellationReasons.working") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminPromoCodes() {
  const { t, i18n } = useTranslation();
  const q = useAdminPromoCodes();
  const categoriesQ = useAdminCategories();
  const servicesQ = useAdminServices();
  const allScopesQ = useAllPromoCodeScopes();
  const create = useCreatePromoCode();
  const update = useUpdatePromoCode();
  const setActive = useSetPromoCodeActive();
  const setScope = useSetPromoCodeScope();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<PromoForm>(EMPTY_FORM);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [createScope, setCreateScope] = useState<{ categoryIds: string[]; serviceIds: string[] }>({
    categoryIds: [],
    serviceIds: [],
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PromoForm>(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [editScopeTouched, setEditScopeTouched] = useState(false);
  const [editScope, setEditScope] = useState<{ categoryIds: string[]; serviceIds: string[] }>({
    categoryIds: [],
    serviceIds: [],
  });
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const editingScopeQ = usePromoCodeScope(editingId);
  const hydratedEditId = useRef<string | null>(null);

  useEffect(() => {
    if (!editingId || !editingScopeQ.data) return;
    if (hydratedEditId.current === editingId) return;
    hydratedEditId.current = editingId;
    setEditScope({
      categoryIds: [...editingScopeQ.data.categoryIds],
      serviceIds: [...editingScopeQ.data.serviceIds],
    });
    setEditScopeTouched(false);
  }, [editingId, editingScopeQ.data]);

  const promos = q.data ?? [];
  const categories = categoriesQ.data ?? [];
  const services = servicesQ.data ?? [];

  const scopeSummary = (p: PromoCodeRow): string => {
    const modeLabel = t(MODE_LABEL_KEYS[p.applicable_mode ?? "all"]);
    let scopeLabel = t("admin.promoCodes.scopeAll");
    const ids = allScopesQ.data?.get(p.id);
    if (p.applicable_scope === "categories") {
      const names = (ids?.categoryIds ?? [])
        .map((id) => categories.find((c: any) => c.id === id))
        .filter(Boolean)
        .map((c: any) => catalogName(c, i18n.language));
      scopeLabel = names.length ? names.join("، ") : t("admin.promoCodes.scopeCategories");
    } else if (p.applicable_scope === "services") {
      const names = (ids?.serviceIds ?? [])
        .map((id) => services.find((s: any) => s.id === id))
        .filter(Boolean)
        .map((s: any) => catalogName(s, i18n.language));
      scopeLabel = names.length ? names.join("، ") : t("admin.promoCodes.scopeServices");
    }
    return `${modeLabel} · ${scopeLabel}`;
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return promos.filter((p) => {
      if (statusFilter === "active" && !p.is_active) return false;
      if (statusFilter === "inactive" && p.is_active) return false;
      if (!needle) return true;
      return (
        p.code.toLowerCase().includes(needle) ||
        (p.description_en ?? "").toLowerCase().includes(needle)
      );
    });
  }, [promos, query, statusFilter]);

  const startCreate = () => {
    setEditingId(null);
    setCreateErrors({});
    setCreateForm(EMPTY_FORM);
    setCreateScope({ categoryIds: [], serviceIds: [] });
    setCreating(true);
  };

  const submitCreate = () => {
    const errors = validate(createForm, t, createScope);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;
    create.mutate(toInput(createForm, true), {
      onSuccess: (row) => {
        const saveScope = () => {
          setCreating(false);
          toast.success(t("admin.promoCodes.created"));
        };
        if (createForm.applicable_scope === "all") {
          saveScope();
          return;
        }
        setScope.mutate(
          {
            promoCodeId: row.id,
            categoryIds: createScope.categoryIds,
            serviceIds: createScope.serviceIds,
          },
          {
            onSuccess: saveScope,
            onError: (e: any) => toast.error(dbErrorMessage(e, t)),
          },
        );
      },
      onError: (e: any) => toast.error(dbErrorMessage(e, t)),
    });
  };

  const startEdit = (p: PromoCodeRow) => {
    setCreating(false);
    setEditErrors({});
    setEditForm(formFromRow(p));
    setEditScope({ categoryIds: [], serviceIds: [] });
    setEditScopeTouched(false);
    hydratedEditId.current = null;
    setEditingId(p.id);
  };

  const submitEdit = (p: PromoCodeRow) => {
    const errors = validate(
      editForm,
      t,
      editForm.applicable_scope !== "all" ? editScope : undefined,
    );
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const finish = () => {
      setEditingId(null);
      toast.success(t("admin.promoCodes.updated"));
    };
    update.mutate(
      { id: p.id, ...toInput(editForm, p.is_active) },
      {
        onSuccess: () => {
          if (!editScopeTouched) {
            finish();
            return;
          }
          setScope.mutate(
            {
              promoCodeId: p.id,
              categoryIds: editScope.categoryIds,
              serviceIds: editScope.serviceIds,
            },
            { onSuccess: finish, onError: (e: any) => toast.error(dbErrorMessage(e, t)) },
          );
        },
        onError: (e: any) => toast.error(dbErrorMessage(e, t)),
      },
    );
  };

  const activate = (p: PromoCodeRow) => {
    setActive.mutate(
      { id: p.id, active: true },
      { onError: (e: any) => toast.error(dbErrorMessage(e, t)) },
    );
  };

  const confirmDeactivate = () => {
    if (!confirmDeactivateId) return;
    setActive.mutate(
      { id: confirmDeactivateId, active: false },
      {
        onSuccess: () => {
          setConfirmDeactivateId(null);
          toast.success(t("admin.promoCodes.deactivated"));
        },
        onError: (e: any) => {
          setConfirmDeactivateId(null);
          toast.error(dbErrorMessage(e, t));
        },
      },
    );
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t("admin.promoCodes.copied", { code }));
    } catch {
      toast.error(t("admin.promoCodes.copyError"));
    }
  };

  return (
    <div className={catalogScreen}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            {t("admin.layout.nav.promoCodes")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("admin.promoCodes.subtitle")}</p>
        </div>
        <button
          onClick={startCreate}
          className="focus-ring inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-bold text-brand-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> {t("admin.promoCodes.newPromo")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.promoCodes.searchPlaceholder")}
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
          {[
            { key: "all" as const, labelKey: "admin.providers.filterAll" },
            { key: "active" as const, labelKey: "admin.customers.filterActive" },
            { key: "inactive" as const, labelKey: "admin.cancellationReasons.inactive" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`focus-ring rounded-lg px-3 py-1.5 text-xs font-bold ${statusFilter === f.key ? "bg-brand text-brand-foreground" : "text-muted-foreground"}`}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {creating && (
        <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-sm">
          <h2 className="text-sm font-extrabold">{t("admin.promoCodes.newPromoTitle")}</h2>
          <div className="mt-4">
            <PromoFormFields
              form={createForm}
              setForm={setCreateForm}
              errors={createErrors}
              categories={categories}
              services={services}
              scope={createScope}
              setScope={setCreateScope}
            />
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={submitCreate}
              disabled={create.isPending}
              className="focus-ring rounded-lg bg-brand px-4 py-2 text-xs font-bold text-brand-foreground disabled:opacity-50"
            >
              {create.isPending
                ? t("admin.cancellationReasons.creating")
                : t("admin.promoCodes.createPromo")}
            </button>
            <button
              onClick={() => setCreating(false)}
              className="focus-ring rounded-lg border border-border px-4 py-2 text-xs font-bold"
            >
              {t("common.cancel")}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-sm">
        {q.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : q.isError ? (
          <AdminQueryError
            message={t("admin.promoCodes.loadError")}
            error={q.error}
            onRetry={() => q.refetch()}
          />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.promoCodes.noResults")}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((p) => {
              const remaining =
                p.total_usage_limit != null
                  ? Math.max(0, p.total_usage_limit - p.usage_count)
                  : null;
              return (
                <li key={p.id} className="rounded-xl border border-border/60 p-3">
                  {editingId === p.id ? (
                    <div className="space-y-3">
                      <PromoFormFields
                        form={editForm}
                        setForm={setEditForm}
                        errors={editErrors}
                        categories={categories}
                        services={services}
                        scope={editScope}
                        setScope={(next) => {
                          setEditScopeTouched(true);
                          setEditScope(next);
                        }}
                        lockCode
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => submitEdit(p)}
                          disabled={update.isPending}
                          className="focus-ring rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground disabled:opacity-50"
                        >
                          {update.isPending
                            ? t("admin.cancellationReasons.saving")
                            : t("common.save")}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-bold"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-coral" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              dir="ltr"
                              className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs font-bold"
                            >
                              {p.code}
                            </span>
                            <button
                              onClick={() => copyCode(p.code)}
                              className="focus-ring text-muted-foreground hover:text-foreground"
                              aria-label={t("admin.promoCodes.copyCode")}
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                            <span className="text-xs font-semibold text-muted-foreground">
                              {t(
                                p.discount_type === "percentage"
                                  ? "adminCatalog.discountPercent"
                                  : "adminCatalog.discountFixed",
                                { value: p.discount_value },
                              )}
                            </span>
                            {!p.is_active && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold uppercase text-muted-foreground">
                                {t("admin.cancellationReasons.inactive")}
                              </span>
                            )}
                            {p.is_featured && (
                              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-bold uppercase text-brand">
                                {t("admin.promoCodes.featured")}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {i18n.language.startsWith("ar") ? p.description_ar : p.description_en}
                          </p>
                          <p className="mt-1 text-xs font-semibold">
                            {t("admin.promoCodes.scope")}: {scopeSummary(p)}
                          </p>
                          <p className="mt-2 text-xs">
                            {t("adminCatalog.ends", {
                              date: p.expires_at
                                ? catalogDate(p.expires_at, i18n.language)
                                : t("adminCatalog.noExpiry"),
                            })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("adminCatalog.usage", {
                              used: p.usage_count,
                              total: p.total_usage_limit ?? t("adminCatalog.unlimited"),
                            })}
                            {remaining != null
                              ? ` · ${t("admin.promoCodes.remaining", { count: remaining })}`
                              : ""}
                            {p.usage_limit_per_customer != null
                              ? ` · ${t("admin.promoCodes.perCustomer", { count: p.usage_limit_per_customer })}`
                              : ""}
                            {p.first_booking_only
                              ? ` · ${t("admin.promoCodes.firstBookingOnly")}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => startEdit(p)}
                          className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-semibold"
                        >
                          {t("common.edit")}
                        </button>
                        {p.is_active ? (
                          <button
                            disabled={setActive.isPending}
                            onClick={() => setConfirmDeactivateId(p.id)}
                            className="focus-ring rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
                          >
                            {t("admin.cancellationReasons.deactivate")}
                          </button>
                        ) : (
                          <button
                            disabled={setActive.isPending}
                            onClick={() => activate(p)}
                            className="focus-ring rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground disabled:opacity-50"
                          >
                            {t("admin.cancellationReasons.activate")}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {confirmDeactivateId && (
        <ConfirmDialog
          title={t("admin.promoCodes.deactivateConfirmTitle")}
          body={t("admin.promoCodes.deactivateConfirmBody")}
          confirmLabel={t("admin.cancellationReasons.deactivate")}
          pending={setActive.isPending}
          onConfirm={confirmDeactivate}
          onCancel={() => setConfirmDeactivateId(null)}
        />
      )}
    </div>
  );
}
