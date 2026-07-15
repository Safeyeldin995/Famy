import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Plus, Search, ArrowUp, ArrowDown, Star, Banknote, Wallet, CreditCard } from "lucide-react";
import {
  useAdminPaymentMethods, useCreatePaymentMethod, useUpdatePaymentMethod,
  useSetPaymentMethodActive, useSetPaymentMethodDisplayOrder, useSetDefaultPaymentMethod,
  type MethodType, type PaymentMethodInput, type PaymentMethodRow,
} from "@/lib/db/payment-methods-queries";

export const Route = createFileRoute("/admin/payment-methods")({ component: AdminPaymentMethods });

const METHOD_TYPES: { value: MethodType; labelKey: string }[] = [
  { value: "cash", labelKey: "admin.paymentMethods.typeCash" },
  { value: "manual_transfer", labelKey: "admin.paymentMethods.typeManualTransfer" },
  { value: "online", labelKey: "admin.paymentMethods.typeOnline" },
];

function typeIcon(t: MethodType) {
  if (t === "cash") return Banknote;
  if (t === "manual_transfer") return Wallet;
  return CreditCard;
}

type MethodForm = {
  code: string;
  name_en: string;
  name_ar: string;
  instructions_en: string;
  instructions_ar: string;
  method_type: MethodType;
  handle: string;
  note: string;
};

const EMPTY_FORM: MethodForm = {
  code: "", name_en: "", name_ar: "", instructions_en: "", instructions_ar: "",
  method_type: "manual_transfer", handle: "", note: "",
};

function formFromRow(m: PaymentMethodRow): MethodForm {
  const cfg = (m.public_config ?? {}) as Record<string, unknown>;
  return {
    code: m.code,
    name_en: m.name_en,
    name_ar: m.name_ar,
    instructions_en: m.instructions_en ?? "",
    instructions_ar: m.instructions_ar ?? "",
    method_type: m.method_type,
    handle: typeof cfg.handle === "string" ? cfg.handle : "",
    note: typeof cfg.note === "string" ? cfg.note : "",
  };
}

function validate(f: MethodForm, t: (key: string) => string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.code.trim()) errors.code = t("admin.cancellationReasons.codeRequired");
  else if (!/^[a-z0-9_]+$/.test(f.code.trim())) errors.code = t("admin.cancellationReasons.codeFormat");
  if (!f.name_en.trim()) errors.name_en = t("admin.cancellationReasons.nameEnRequired");
  if (!f.name_ar.trim()) errors.name_ar = t("admin.cancellationReasons.nameArRequired");
  return errors;
}

function toInput(f: MethodForm, is_active: boolean, display_order: number): PaymentMethodInput {
  const public_config: Record<string, unknown> = {};
  if (f.handle.trim()) public_config.handle = f.handle.trim();
  if (f.note.trim()) public_config.note = f.note.trim();
  return {
    code: f.code.trim(),
    name_en: f.name_en.trim(),
    name_ar: f.name_ar.trim(),
    instructions_en: f.instructions_en.trim() || null,
    instructions_ar: f.instructions_ar.trim() || null,
    method_type: f.method_type,
    is_active,
    display_order,
    public_config,
  };
}

function dbErrorMessage(e: any, t: (key: string) => string): string {
  if (e?.code === "23505") return t("admin.paymentMethods.codeExists");
  if (e?.code === "23514") return e?.message ?? t("admin.cancellationReasons.valueNotAllowed");
  return e?.message ?? t("admin.cancellationReasons.genericError");
}

function MethodFormFields({ form, setForm, errors, lockCode }: {
  form: MethodForm; setForm: (f: MethodForm) => void; errors: Record<string, string>; lockCode?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.cancellationReasons.code")}</span>
          <input dir="ltr" value={form.code} disabled={lockCode} onChange={(e) => setForm({ ...form, code: e.target.value.trim().toLowerCase() })}
            placeholder={t("admin.paymentMethods.codePlaceholder")}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm disabled:opacity-60" />
          {errors.code && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.code}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.paymentMethods.type")}</span>
          <select value={form.method_type} onChange={(e) => setForm({ ...form, method_type: e.target.value as MethodType })}
            className="focus-ring mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm">
            {METHOD_TYPES.map((mt) => <option key={mt.value} value={mt.value}>{t(mt.labelKey)}</option>)}
          </select>
        </label>
      </div>

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
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.paymentMethods.instructionsEn")}</span>
          <textarea dir="ltr" rows={2} value={form.instructions_en} onChange={(e) => setForm({ ...form, instructions_en: e.target.value })}
            className="mt-1 w-full resize-none rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">{t("admin.paymentMethods.instructionsAr")}</span>
          <textarea rows={2} value={form.instructions_ar} onChange={(e) => setForm({ ...form, instructions_ar: e.target.value })} dir="rtl"
            className="mt-1 w-full resize-none rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
        </label>
      </div>

      {form.method_type === "manual_transfer" && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/60 bg-surface-2 p-3">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">{t("admin.paymentMethods.receiverHandle")}</span>
            <input value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} dir="ltr"
              placeholder={t("admin.paymentMethods.receiverHandlePlaceholder")}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">{t("admin.paymentMethods.receiverNote")}</span>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          </label>
          <p className="col-span-2 text-[11px] text-muted-foreground">
            {t("admin.paymentMethods.customerSafeNote")}
          </p>
        </div>
      )}
      {form.method_type === "online" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
          {t("admin.paymentMethods.onlineNotImplemented")}
        </p>
      )}
    </div>
  );
}

function ConfirmDialog({ title, body, confirmLabel, pending, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; pending: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="pm-confirm-title" className="w-full max-w-sm rounded-2xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div id="pm-confirm-title" className="text-base font-extrabold">{title}</div>
        <p className="mt-1 text-xs text-muted-foreground">{body}</p>
        <div className="mt-4 flex gap-2">
          <button onClick={onCancel} className="focus-ring h-11 flex-1 rounded-xl border border-border text-sm font-bold">{t("common.cancel")}</button>
          <button onClick={onConfirm} disabled={pending} className="focus-ring h-11 flex-1 rounded-xl bg-navy text-sm font-bold text-navy-foreground disabled:opacity-50">
            {pending ? t("admin.cancellationReasons.working") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminPaymentMethods() {
  const { t } = useTranslation();
  const q = useAdminPaymentMethods();
  const create = useCreatePaymentMethod();
  const update = useUpdatePaymentMethod();
  const setActive = useSetPaymentMethodActive();
  const setOrder = useSetPaymentMethodDisplayOrder();
  const setDefault = useSetDefaultPaymentMethod();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<MethodForm>(EMPTY_FORM);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MethodForm>(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [confirmDefaultId, setConfirmDefaultId] = useState<string | null>(null);

  const methods = q.data ?? [];

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return methods
      .filter((m) => {
        if (statusFilter === "active" && !m.is_active) return false;
        if (statusFilter === "inactive" && m.is_active) return false;
        if (!needle) return true;
        return (
          m.name_en.toLowerCase().includes(needle) ||
          m.name_ar.toLowerCase().includes(needle) ||
          m.code.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => a.display_order - b.display_order);
  }, [methods, query, statusFilter]);

  const startCreate = () => { setEditingId(null); setCreateErrors({}); setCreateForm(EMPTY_FORM); setCreating(true); };

  const submitCreate = () => {
    const errors = validate(createForm, t);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const nextOrder = methods.length > 0 ? Math.max(...methods.map((m) => m.display_order)) + 1 : 1;
    create.mutate(toInput(createForm, createForm.method_type !== "online", nextOrder), {
      onSuccess: () => { setCreating(false); toast.success(t("admin.paymentMethods.created")); },
      onError: (e: any) => toast.error(dbErrorMessage(e, t)),
    });
  };

  const startEdit = (m: PaymentMethodRow) => { setCreating(false); setEditErrors({}); setEditForm(formFromRow(m)); setEditingId(m.id); };

  const submitEdit = (m: PaymentMethodRow) => {
    const errors = validate(editForm, t);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    // Switching a method to "online" mid-edit must not leave it active —
    // no gateway processing is implemented for it.
    const nextActive = editForm.method_type === "online" ? false : m.is_active;
    update.mutate({ id: m.id, ...toInput(editForm, nextActive, m.display_order) }, {
      onSuccess: () => { setEditingId(null); toast.success(t("admin.paymentMethods.updated")); },
      onError: (e: any) => toast.error(dbErrorMessage(e, t)),
    });
  };

  const activate = (m: PaymentMethodRow) => {
    setActive.mutate({ id: m.id, active: true }, { onError: (e: any) => toast.error(dbErrorMessage(e, t)) });
  };

  const confirmDeactivate = () => {
    if (!confirmDeactivateId) return;
    setActive.mutate({ id: confirmDeactivateId, active: false }, {
      onSuccess: () => { setConfirmDeactivateId(null); toast.success(t("admin.paymentMethods.deactivated")); },
      onError: (e: any) => { setConfirmDeactivateId(null); toast.error(dbErrorMessage(e, t)); },
    });
  };

  const confirmSetDefault = () => {
    if (!confirmDefaultId) return;
    setDefault.mutate(confirmDefaultId, {
      onSuccess: () => { setConfirmDefaultId(null); toast.success(t("admin.paymentMethods.defaultUpdated")); },
      onError: (e: any) => { setConfirmDefaultId(null); toast.error(dbErrorMessage(e, t)); },
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = rows[index + direction];
    const current = rows[index];
    if (!target || !current) return;
    setOrder.mutate({ id: current.id, display_order: target.display_order });
    setOrder.mutate({ id: target.id, display_order: current.display_order });
  };

  return (
    <div className="px-5 py-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("admin.layout.nav.paymentMethods")}</h1>
          <p className="text-xs text-muted-foreground">{t("admin.paymentMethods.subtitle")}</p>
        </div>
        <button onClick={startCreate} className="focus-ring inline-flex items-center gap-1.5 rounded-xl bg-navy px-3 py-2 text-xs font-bold text-navy-foreground">
          <Plus className="h-3.5 w-3.5" /> {t("admin.paymentMethods.newMethod")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.cancellationReasons.searchPlaceholder")} className="w-full bg-transparent text-sm outline-none" />
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
          {([
            { key: "all" as const, labelKey: "admin.providers.filterAll" },
            { key: "active" as const, labelKey: "admin.customers.filterActive" },
            { key: "inactive" as const, labelKey: "admin.cancellationReasons.inactive" },
          ]).map((f) => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className={`focus-ring rounded-lg px-3 py-1.5 text-xs font-bold ${statusFilter === f.key ? "bg-navy text-navy-foreground" : "text-muted-foreground"}`}>
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {creating && (
        <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
          <h2 className="text-sm font-extrabold">{t("admin.paymentMethods.newMethodTitle")}</h2>
          <div className="mt-4"><MethodFormFields form={createForm} setForm={setCreateForm} errors={createErrors} /></div>
          <div className="mt-4 flex gap-2">
            <button onClick={submitCreate} disabled={create.isPending} className="focus-ring rounded-lg bg-navy px-4 py-2 text-xs font-bold text-navy-foreground disabled:opacity-50">
              {create.isPending ? t("admin.cancellationReasons.creating") : t("admin.paymentMethods.createMethod")}
            </button>
            <button onClick={() => setCreating(false)} className="focus-ring rounded-lg border border-border px-4 py-2 text-xs font-bold">{t("common.cancel")}</button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : q.isError ? (
          <p className="text-sm text-coral">{t("admin.paymentMethods.loadError")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.paymentMethods.noResults")}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((m, i) => {
              const Icon = typeIcon(m.method_type);
              return (
                <li key={m.id} className="rounded-xl border border-border/60 p-3">
                  {editingId === m.id ? (
                    <div className="space-y-3">
                      <MethodFormFields form={editForm} setForm={setEditForm} errors={editErrors} lockCode />
                      <div className="flex gap-2">
                        <button onClick={() => submitEdit(m)} disabled={update.isPending} className="focus-ring rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50">
                          {update.isPending ? t("admin.cancellationReasons.saving") : t("common.save")}
                        </button>
                        <button onClick={() => setEditingId(null)} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-bold">{t("common.cancel")}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="flex shrink-0 flex-col">
                          <button disabled={i === 0 || setOrder.isPending} onClick={() => move(i, -1)} aria-label={t("admin.cancellationReasons.moveUp")} className="focus-ring grid h-5 w-5 place-items-center text-muted-foreground disabled:opacity-30">
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button disabled={i === rows.length - 1 || setOrder.isPending} onClick={() => move(i, 1)} aria-label={t("admin.cancellationReasons.moveDown")} className="focus-ring grid h-5 w-5 place-items-center text-muted-foreground disabled:opacity-30">
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-coral" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-sm font-semibold">{m.name_en} <span className="text-muted-foreground">/ {m.name_ar}</span></p>
                            <span dir="ltr" className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{m.code}</span>
                            {m.is_default && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-mint/30 px-2 py-0.5 text-[10px] font-bold uppercase text-success">
                                <Star className="h-2.5 w-2.5" /> {t("admin.paymentMethods.default")}
                              </span>
                            )}
                            {!m.is_active && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{t("admin.cancellationReasons.inactive")}</span>}
                          </div>
                          <p className="text-[11px] text-muted-foreground">{t(METHOD_TYPES.find((mt) => mt.value === m.method_type)?.labelKey ?? "")}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {m.is_active && !m.is_default && (
                          <button onClick={() => setConfirmDefaultId(m.id)} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">{t("admin.paymentMethods.setDefault")}</button>
                        )}
                        <button onClick={() => startEdit(m)} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">{t("common.edit")}</button>
                        {m.is_active ? (
                          <button
                            disabled={setActive.isPending}
                            onClick={() => setConfirmDeactivateId(m.id)}
                            className="focus-ring rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
                          >
                            {t("admin.cancellationReasons.deactivate")}
                          </button>
                        ) : (
                          <button
                            disabled={setActive.isPending || m.method_type === "online"}
                            title={m.method_type === "online" ? t("admin.paymentMethods.onlineNotImplementedShort") : undefined}
                            onClick={() => activate(m)}
                            className="focus-ring rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
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
          title={t("admin.paymentMethods.deactivateConfirmTitle")}
          body={t("admin.paymentMethods.deactivateConfirmBody")}
          confirmLabel={t("admin.cancellationReasons.deactivate")}
          pending={setActive.isPending}
          onConfirm={confirmDeactivate}
          onCancel={() => setConfirmDeactivateId(null)}
        />
      )}
      {confirmDefaultId && (
        <ConfirmDialog
          title={t("admin.paymentMethods.setDefaultConfirmTitle")}
          body={t("admin.paymentMethods.setDefaultConfirmBody")}
          confirmLabel={t("admin.paymentMethods.setDefault")}
          pending={setDefault.isPending}
          onConfirm={confirmSetDefault}
          onCancel={() => setConfirmDefaultId(null)}
        />
      )}
    </div>
  );
}
