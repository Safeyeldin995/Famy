import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Copy, Tag } from "lucide-react";
import {
  useAdminPromoCodes, useCreatePromoCode, useUpdatePromoCode, useSetPromoCodeActive,
  usePromoCodeScope, useSetPromoCodeScope,
  type DiscountType, type ApplicableScope, type PromoCodeInput, type PromoCodeRow,
} from "@/lib/db/promo-codes-queries";
import { useAdminCategories, useAdminServices } from "@/lib/db/admin-queries";

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
};

const EMPTY_FORM: PromoForm = {
  code: "", description_en: "", description_ar: "",
  discount_type: "fixed", discount_value: "", maximum_discount: "",
  minimum_booking_amount: "0", starts_at: "", expires_at: "",
  total_usage_limit: "", usage_limit_per_customer: "1",
  first_booking_only: false, applicable_scope: "all",
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
    usage_limit_per_customer: p.usage_limit_per_customer != null ? String(p.usage_limit_per_customer) : "",
    first_booking_only: p.first_booking_only,
    applicable_scope: p.applicable_scope,
  };
}

function validate(f: PromoForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.code.trim()) errors.code = "Code is required.";
  else if (!/^[a-zA-Z0-9_-]+$/.test(f.code.trim())) errors.code = "Use letters, numbers, underscores and hyphens only.";
  const value = Number(f.discount_value);
  if (!Number.isFinite(value) || value <= 0) errors.discount_value = "Must be greater than 0.";
  else if (f.discount_type === "percentage" && value > 100) errors.discount_value = "Percentage cannot exceed 100.";
  if (f.maximum_discount.trim()) {
    const max = Number(f.maximum_discount);
    if (!Number.isFinite(max) || max < 0) errors.maximum_discount = "Must be 0 or more.";
  }
  const min = Number(f.minimum_booking_amount);
  if (!Number.isFinite(min) || min < 0) errors.minimum_booking_amount = "Must be 0 or more.";
  if (f.total_usage_limit.trim()) {
    const lim = Number(f.total_usage_limit);
    if (!Number.isInteger(lim) || lim <= 0) errors.total_usage_limit = "Must be a whole number greater than 0.";
  }
  if (f.usage_limit_per_customer.trim()) {
    const lim = Number(f.usage_limit_per_customer);
    if (!Number.isInteger(lim) || lim <= 0) errors.usage_limit_per_customer = "Must be a whole number greater than 0.";
  }
  if (f.starts_at && f.expires_at && new Date(f.expires_at) <= new Date(f.starts_at)) {
    errors.expires_at = "Must be after the start date.";
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
    usage_limit_per_customer: f.usage_limit_per_customer.trim() ? Number(f.usage_limit_per_customer) : null,
    first_booking_only: f.first_booking_only,
    applicable_scope: f.applicable_scope,
    is_active,
  };
}

function dbErrorMessage(e: any): string {
  if (e?.code === "23505") return "A promo code with this code already exists.";
  if (e?.code === "23514") return e?.message ?? "That value isn't allowed.";
  return e?.message ?? "Something went wrong. Please try again.";
}

function PromoFormFields({
  form, setForm, errors, categories, services, scope, setScope, lockCode,
}: {
  form: PromoForm; setForm: (f: PromoForm) => void; errors: Record<string, string>;
  categories: any[]; services: any[];
  scope: { categoryIds: string[]; serviceIds: string[] }; setScope: (s: { categoryIds: string[]; serviceIds: string[] }) => void;
  lockCode?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Code</span>
          <input value={form.code} disabled={lockCode} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} dir="ltr"
            placeholder="e.g. WELCOME20"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm font-mono disabled:opacity-60" />
          {errors.code && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.code}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Scope</span>
          <select value={form.applicable_scope} onChange={(e) => setForm({ ...form, applicable_scope: e.target.value as ApplicableScope })}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm">
            <option value="all">All services</option>
            <option value="categories">Specific categories</option>
            <option value="services">Specific services</option>
          </select>
        </label>
      </div>

      {form.applicable_scope === "categories" && (
        <div className="rounded-lg border border-border/60 bg-surface-2 p-3">
          <span className="text-xs font-semibold text-muted-foreground">Categories</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {categories.map((c: any) => {
              const checked = scope.categoryIds.includes(c.id);
              return (
                <label key={c.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${checked ? "border-navy bg-navy/10 text-navy" : "border-border text-muted-foreground"}`}>
                  <input type="checkbox" checked={checked} className="hidden"
                    onChange={() => setScope({ ...scope, categoryIds: checked ? scope.categoryIds.filter((id) => id !== c.id) : [...scope.categoryIds, c.id] })} />
                  {c.name_en}
                </label>
              );
            })}
          </div>
        </div>
      )}
      {form.applicable_scope === "services" && (
        <div className="rounded-lg border border-border/60 bg-surface-2 p-3">
          <span className="text-xs font-semibold text-muted-foreground">Services</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {services.map((s: any) => {
              const checked = scope.serviceIds.includes(s.id);
              return (
                <label key={s.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${checked ? "border-navy bg-navy/10 text-navy" : "border-border text-muted-foreground"}`}>
                  <input type="checkbox" checked={checked} className="hidden"
                    onChange={() => setScope({ ...scope, serviceIds: checked ? scope.serviceIds.filter((id) => id !== s.id) : [...scope.serviceIds, s.id] })} />
                  {s.name_en}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">English description (optional)</span>
          <textarea value={form.description_en} onChange={(e) => setForm({ ...form, description_en: e.target.value })} rows={2}
            className="mt-1 w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Arabic description (optional)</span>
          <textarea value={form.description_ar} onChange={(e) => setForm({ ...form, description_ar: e.target.value })} rows={2} dir="rtl"
            className="mt-1 w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Discount type</span>
          <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as DiscountType })}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm">
            <option value="fixed">Fixed (EGP)</option>
            <option value="percentage">Percentage</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{form.discount_type === "percentage" ? "Discount (%)" : "Discount (EGP)"}</span>
          <input value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} type="number" min={0} step={1}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.discount_value && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.discount_value}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Max discount (EGP, optional)</span>
          <input value={form.maximum_discount} onChange={(e) => setForm({ ...form, maximum_discount: e.target.value })} type="number" min={0} step={1}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.maximum_discount && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.maximum_discount}</p>}
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Min booking amount (EGP)</span>
          <input value={form.minimum_booking_amount} onChange={(e) => setForm({ ...form, minimum_booking_amount: e.target.value })} type="number" min={0} step={1}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.minimum_booking_amount && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.minimum_booking_amount}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Total usage limit (optional)</span>
          <input value={form.total_usage_limit} onChange={(e) => setForm({ ...form, total_usage_limit: e.target.value })} type="number" min={1} step={1}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.total_usage_limit && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.total_usage_limit}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Per-customer limit (optional)</span>
          <input value={form.usage_limit_per_customer} onChange={(e) => setForm({ ...form, usage_limit_per_customer: e.target.value })} type="number" min={1} step={1}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.usage_limit_per_customer && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.usage_limit_per_customer}</p>}
        </label>
      </div>

      <div className="grid grid-cols-3 items-end gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Starts at (optional)</span>
          <input value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} type="datetime-local"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Expires at (optional)</span>
          <input value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} type="datetime-local"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.expires_at && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.expires_at}</p>}
        </label>
        <label className="flex h-9 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={form.first_booking_only} onChange={(e) => setForm({ ...form, first_booking_only: e.target.checked })} />
          <span className="text-xs font-semibold text-muted-foreground">First booking only</span>
        </label>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, body, confirmLabel, pending, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; pending: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-extrabold">{title}</div>
        <p className="mt-1 text-xs text-muted-foreground">{body}</p>
        <div className="mt-4 flex gap-2">
          <button onClick={onCancel} className="h-11 flex-1 rounded-xl border border-border text-sm font-bold">Cancel</button>
          <button onClick={onConfirm} disabled={pending} className="h-11 flex-1 rounded-xl bg-navy text-sm font-bold text-navy-foreground disabled:opacity-50">
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminPromoCodes() {
  const q = useAdminPromoCodes();
  const categoriesQ = useAdminCategories();
  const servicesQ = useAdminServices();
  const create = useCreatePromoCode();
  const update = useUpdatePromoCode();
  const setActive = useSetPromoCodeActive();
  const setScope = useSetPromoCodeScope();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<PromoForm>(EMPTY_FORM);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [createScope, setCreateScope] = useState<{ categoryIds: string[]; serviceIds: string[] }>({ categoryIds: [], serviceIds: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PromoForm>(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [editScope, setEditScope] = useState<{ categoryIds: string[]; serviceIds: string[] }>({ categoryIds: [], serviceIds: [] });
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const editingScopeQ = usePromoCodeScope(editingId);

  const promos = q.data ?? [];
  const categories = categoriesQ.data ?? [];
  const services = servicesQ.data ?? [];

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return promos.filter((p) => {
      if (statusFilter === "active" && !p.is_active) return false;
      if (statusFilter === "inactive" && p.is_active) return false;
      if (!needle) return true;
      return p.code.toLowerCase().includes(needle) || (p.description_en ?? "").toLowerCase().includes(needle);
    });
  }, [promos, query, statusFilter]);

  const startCreate = () => {
    setEditingId(null); setCreateErrors({}); setCreateForm(EMPTY_FORM);
    setCreateScope({ categoryIds: [], serviceIds: [] }); setCreating(true);
  };

  const submitCreate = () => {
    const errors = validate(createForm);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;
    create.mutate(toInput(createForm, true), {
      onSuccess: (row) => {
        const needsScope = createForm.applicable_scope !== "all" && (createScope.categoryIds.length > 0 || createScope.serviceIds.length > 0);
        if (needsScope) {
          setScope.mutate({ promoCodeId: row.id, categoryIds: createScope.categoryIds, serviceIds: createScope.serviceIds });
        }
        setCreating(false);
        toast.success("Promo code created.");
      },
      onError: (e: any) => toast.error(dbErrorMessage(e)),
    });
  };

  const startEdit = (p: PromoCodeRow) => {
    setCreating(false); setEditErrors({}); setEditForm(formFromRow(p));
    setEditScope({ categoryIds: [], serviceIds: [] }); setEditingId(p.id);
  };

  const submitEdit = (p: PromoCodeRow) => {
    const errors = validate(editForm);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    update.mutate({ id: p.id, ...toInput(editForm, p.is_active) }, {
      onSuccess: () => {
        setScope.mutate({ promoCodeId: p.id, categoryIds: editScope.categoryIds, serviceIds: editScope.serviceIds });
        setEditingId(null);
        toast.success("Promo code updated.");
      },
      onError: (e: any) => toast.error(dbErrorMessage(e)),
    });
  };

  const activate = (p: PromoCodeRow) => {
    setActive.mutate({ id: p.id, active: true }, { onError: (e: any) => toast.error(dbErrorMessage(e)) });
  };

  const confirmDeactivate = () => {
    if (!confirmDeactivateId) return;
    setActive.mutate({ id: confirmDeactivateId, active: false }, {
      onSuccess: () => { setConfirmDeactivateId(null); toast.success("Promo code deactivated."); },
      onError: (e: any) => { setConfirmDeactivateId(null); toast.error(dbErrorMessage(e)); },
    });
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Copied "${code}" to clipboard.`);
    } catch {
      toast.error("Could not copy code.");
    }
  };

  return (
    <div className="px-5 py-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Promo Codes</h1>
          <p className="text-xs text-muted-foreground">Deactivate instead of deleting — historical bookings keep their own snapshot of the promo regardless.</p>
        </div>
        <button onClick={startCreate} className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-3 py-2 text-xs font-bold text-navy-foreground">
          <Plus className="h-3.5 w-3.5" /> New promo code
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by code or description…" className="w-full bg-transparent text-sm outline-none" />
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${statusFilter === f ? "bg-navy text-navy-foreground" : "text-muted-foreground"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {creating && (
        <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
          <h2 className="text-sm font-extrabold">New promo code</h2>
          <div className="mt-4">
            <PromoFormFields form={createForm} setForm={setCreateForm} errors={createErrors} categories={categories} services={services} scope={createScope} setScope={setCreateScope} />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={submitCreate} disabled={create.isPending} className="rounded-lg bg-navy px-4 py-2 text-xs font-bold text-navy-foreground disabled:opacity-50">
              {create.isPending ? "Creating…" : "Create promo code"}
            </button>
            <button onClick={() => setCreating(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-bold">Cancel</button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : q.isError ? (
          <p className="text-sm text-coral">Could not load promo codes. Please refresh.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No promo codes match this search/filter.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((p) => {
              const remaining = p.total_usage_limit != null ? Math.max(0, p.total_usage_limit - p.usage_count) : null;
              return (
                <li key={p.id} className="rounded-xl border border-border/60 p-3">
                  {editingId === p.id ? (
                    <div className="space-y-3">
                      <PromoFormFields
                        form={editForm} setForm={setEditForm} errors={editErrors}
                        categories={categories} services={services}
                        scope={editingScopeQ.data ? { categoryIds: editScope.categoryIds.length || editScope.serviceIds.length ? editScope.categoryIds : editingScopeQ.data.categoryIds, serviceIds: editScope.categoryIds.length || editScope.serviceIds.length ? editScope.serviceIds : editingScopeQ.data.serviceIds } : editScope}
                        setScope={setEditScope}
                        lockCode
                      />
                      <div className="flex gap-2">
                        <button onClick={() => submitEdit(p)} disabled={update.isPending} className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50">
                          {update.isPending ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => setEditingId(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-coral" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs font-bold">{p.code}</span>
                            <button onClick={() => copyCode(p.code)} className="text-muted-foreground hover:text-foreground" aria-label="Copy code">
                              <Copy className="h-3 w-3" />
                            </button>
                            <span className="text-xs font-semibold text-muted-foreground">
                              {p.discount_type === "percentage" ? `${p.discount_value}%` : `${p.discount_value} EGP`} off
                            </span>
                            {!p.is_active && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Inactive</span>}
                          </div>
                          {p.description_en && <p className="text-[11px] text-muted-foreground">{p.description_en}</p>}
                          <p className="text-[11px] text-muted-foreground">
                            Used {p.usage_count}{p.total_usage_limit != null ? ` / ${p.total_usage_limit}` : ""}
                            {remaining != null ? ` · ${remaining} remaining` : ""}
                            {p.usage_limit_per_customer != null ? ` · ${p.usage_limit_per_customer} per customer` : ""}
                            {p.first_booking_only ? " · first booking only" : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button onClick={() => startEdit(p)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Edit</button>
                        {p.is_active ? (
                          <button
                            disabled={setActive.isPending}
                            onClick={() => setConfirmDeactivateId(p.id)}
                            className="rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            disabled={setActive.isPending}
                            onClick={() => activate(p)}
                            className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
                          >
                            Activate
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
          title="Deactivate this promo code?"
          body="Customers will no longer be able to apply it to new bookings. Bookings that already used it keep their own record regardless."
          confirmLabel="Deactivate"
          pending={setActive.isPending}
          onConfirm={confirmDeactivate}
          onCancel={() => setConfirmDeactivateId(null)}
        />
      )}
    </div>
  );
}
