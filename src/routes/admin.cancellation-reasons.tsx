import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, ArrowUp, ArrowDown, Search } from "lucide-react";
import {
  useAdminCancellationReasons, useCreateCancellationReason, useUpdateCancellationReason,
  useSetCancellationReasonActive, useSetCancellationReasonDisplayOrder,
  type CancellationActorType, type CancellationReasonInput, type CancellationReasonRow,
} from "@/lib/db/cancellation-queries";

export const Route = createFileRoute("/admin/cancellation-reasons")({ component: AdminCancellationReasons });

const ACTOR_TYPES: { value: CancellationActorType; label: string }[] = [
  { value: "customer", label: "Customer" },
  { value: "provider", label: "Provider" },
  { value: "admin", label: "Admin (support)" },
  { value: "any", label: "Any" },
];

type ReasonForm = {
  code: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  actor_type: CancellationActorType;
  requires_note: boolean;
};

const EMPTY_FORM: ReasonForm = {
  code: "", name_en: "", name_ar: "", description_en: "", description_ar: "",
  actor_type: "customer", requires_note: false,
};

function formFromRow(r: CancellationReasonRow): ReasonForm {
  return {
    code: r.code,
    name_en: r.name_en,
    name_ar: r.name_ar,
    description_en: r.description_en ?? "",
    description_ar: r.description_ar ?? "",
    actor_type: r.actor_type,
    requires_note: r.requires_note,
  };
}

function validate(f: ReasonForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.code.trim()) errors.code = "Code is required.";
  else if (!/^[a-z0-9_]+$/.test(f.code.trim())) errors.code = "Use lowercase letters, numbers and underscores only.";
  if (!f.name_en.trim()) errors.name_en = "English name is required.";
  if (!f.name_ar.trim()) errors.name_ar = "Arabic name is required.";
  return errors;
}

function toInput(f: ReasonForm, is_active: boolean, display_order: number): CancellationReasonInput {
  return {
    code: f.code.trim(),
    name_en: f.name_en.trim(),
    name_ar: f.name_ar.trim(),
    description_en: f.description_en.trim() || null,
    description_ar: f.description_ar.trim() || null,
    actor_type: f.actor_type,
    requires_note: f.requires_note,
    is_active,
    display_order,
  };
}

function dbErrorMessage(e: any): string {
  if (e?.code === "23505") return "A cancellation reason with this code already exists.";
  if (e?.code === "23514") return e?.message ?? "That value isn't allowed.";
  return e?.message ?? "Something went wrong. Please try again.";
}

function ReasonFormFields({ form, setForm, errors, lockCode }: {
  form: ReasonForm; setForm: (f: ReasonForm) => void; errors: Record<string, string>; lockCode?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Code</span>
          <input value={form.code} disabled={lockCode} onChange={(e) => setForm({ ...form, code: e.target.value.trim().toLowerCase() })}
            placeholder="e.g. customer_other"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm disabled:opacity-60" />
          {errors.code && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.code}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Actor</span>
          <select value={form.actor_type} onChange={(e) => setForm({ ...form, actor_type: e.target.value as CancellationActorType })}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm">
            {ACTOR_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">English name</span>
          <input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.name_en && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.name_en}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Arabic name</span>
          <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} dir="rtl"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.name_ar && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.name_ar}</p>}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">English description (optional)</span>
          <textarea rows={2} value={form.description_en} onChange={(e) => setForm({ ...form, description_en: e.target.value })}
            className="mt-1 w-full resize-none rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Arabic description (optional)</span>
          <textarea rows={2} value={form.description_ar} onChange={(e) => setForm({ ...form, description_ar: e.target.value })} dir="rtl"
            className="mt-1 w-full resize-none rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
        </label>
      </div>

      <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <input type="checkbox" checked={form.requires_note} onChange={(e) => setForm({ ...form, requires_note: e.target.checked })} />
        Require a note when this reason is selected
      </label>
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

function AdminCancellationReasons() {
  const [actorFilter, setActorFilter] = useState<CancellationActorType | "all">("all");
  const q = useAdminCancellationReasons(actorFilter === "all" ? undefined : actorFilter);
  const create = useCreateCancellationReason();
  const update = useUpdateCancellationReason();
  const setActive = useSetCancellationReasonActive();
  const setOrder = useSetCancellationReasonDisplayOrder();

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<ReasonForm>(EMPTY_FORM);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ReasonForm>(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const reasons = q.data ?? [];

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reasons
      .filter((r) => {
        if (!needle) return true;
        return r.name_en.toLowerCase().includes(needle) || r.name_ar.toLowerCase().includes(needle) || r.code.toLowerCase().includes(needle);
      })
      .sort((a, b) => a.display_order - b.display_order);
  }, [reasons, query]);

  const startCreate = () => { setEditingId(null); setCreateErrors({}); setCreateForm(EMPTY_FORM); setCreating(true); };

  const submitCreate = () => {
    const errors = validate(createForm);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const siblings = reasons.filter((r) => r.actor_type === createForm.actor_type);
    const nextOrder = siblings.length > 0 ? Math.max(...siblings.map((r) => r.display_order)) + 1 : 1;
    create.mutate(toInput(createForm, true, nextOrder), {
      onSuccess: () => { setCreating(false); toast.success("Cancellation reason created."); },
      onError: (e: any) => toast.error(dbErrorMessage(e)),
    });
  };

  const startEdit = (r: CancellationReasonRow) => { setCreating(false); setEditErrors({}); setEditForm(formFromRow(r)); setEditingId(r.id); };

  const submitEdit = (r: CancellationReasonRow) => {
    const errors = validate(editForm);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    update.mutate({ id: r.id, ...toInput(editForm, r.is_active, r.display_order) }, {
      onSuccess: () => { setEditingId(null); toast.success("Cancellation reason updated."); },
      onError: (e: any) => toast.error(dbErrorMessage(e)),
    });
  };

  const activate = (r: CancellationReasonRow) => {
    setActive.mutate({ id: r.id, active: true }, { onError: (e: any) => toast.error(dbErrorMessage(e)) });
  };

  const confirmDeactivate = () => {
    if (!confirmDeactivateId) return;
    setActive.mutate({ id: confirmDeactivateId, active: false }, {
      onSuccess: () => { setConfirmDeactivateId(null); toast.success("Cancellation reason deactivated."); },
      onError: (e: any) => { setConfirmDeactivateId(null); toast.error(dbErrorMessage(e)); },
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = rows[index + direction];
    const current = rows[index];
    if (!target || !current || target.actor_type !== current.actor_type) return;
    setOrder.mutate({ id: current.id, display_order: target.display_order });
    setOrder.mutate({ id: target.id, display_order: current.display_order });
  };

  return (
    <div className="px-5 py-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Cancellation Reasons</h1>
          <p className="text-xs text-muted-foreground">Reasons offered when a customer, provider, or support cancels a pending/confirmed booking. Deactivate instead of deleting — past cancellations keep their own snapshot regardless.</p>
        </div>
        <button onClick={startCreate} className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-3 py-2 text-xs font-bold text-navy-foreground">
          <Plus className="h-3.5 w-3.5" /> New reason
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or code…" className="w-full bg-transparent text-sm outline-none" />
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
          {(["all", ...ACTOR_TYPES.map((t) => t.value)] as const).map((f) => (
            <button key={f} onClick={() => setActorFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${actorFilter === f ? "bg-navy text-navy-foreground" : "text-muted-foreground"}`}>
              {f === "all" ? "All" : ACTOR_TYPES.find((t) => t.value === f)?.label}
            </button>
          ))}
        </div>
      </div>

      {creating && (
        <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
          <h2 className="text-sm font-extrabold">New cancellation reason</h2>
          <div className="mt-4"><ReasonFormFields form={createForm} setForm={setCreateForm} errors={createErrors} /></div>
          <div className="mt-4 flex gap-2">
            <button onClick={submitCreate} disabled={create.isPending} className="rounded-lg bg-navy px-4 py-2 text-xs font-bold text-navy-foreground disabled:opacity-50">
              {create.isPending ? "Creating…" : "Create reason"}
            </button>
            <button onClick={() => setCreating(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-bold">Cancel</button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : q.isError ? (
          <p className="text-sm text-coral">Could not load cancellation reasons. Please refresh.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cancellation reasons match this search/filter.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.id} className="rounded-xl border border-border/60 p-3">
                {editingId === r.id ? (
                  <div className="space-y-3">
                    <ReasonFormFields form={editForm} setForm={setEditForm} errors={editErrors} lockCode />
                    <div className="flex gap-2">
                      <button onClick={() => submitEdit(r)} disabled={update.isPending} className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50">
                        {update.isPending ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setEditingId(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="flex shrink-0 flex-col">
                        <button disabled={i === 0 || setOrder.isPending} onClick={() => move(i, -1)} className="grid h-5 w-5 place-items-center text-muted-foreground disabled:opacity-30">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button disabled={i === rows.length - 1 || setOrder.isPending} onClick={() => move(i, 1)} className="grid h-5 w-5 place-items-center text-muted-foreground disabled:opacity-30">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-semibold">{r.name_en} <span className="text-muted-foreground">/ {r.name_ar}</span></p>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{r.code}</span>
                          <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[10px] font-bold uppercase text-navy">{r.actor_type}</span>
                          {r.requires_note && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">Note required</span>}
                          {!r.is_active && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Inactive</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button onClick={() => startEdit(r)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Edit</button>
                      {r.is_active ? (
                        <button
                          disabled={setActive.isPending}
                          onClick={() => setConfirmDeactivateId(r.id)}
                          className="rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          disabled={setActive.isPending}
                          onClick={() => activate(r)}
                          className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
                        >
                          Activate
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirmDeactivateId && (
        <ConfirmDialog
          title="Deactivate this cancellation reason?"
          body="Customers/providers/admins will no longer be able to select it for new cancellations. Existing cancellation records keep their own snapshot regardless."
          confirmLabel="Deactivate"
          pending={setActive.isPending}
          onConfirm={confirmDeactivate}
          onCancel={() => setConfirmDeactivateId(null)}
        />
      )}
    </div>
  );
}
