import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, MapPin } from "lucide-react";
import {
  useAdminZones, useCreateZone, useUpdateZone, useSetZoneActive,
  useZoneServiceCoverage, useSetZoneService, useZoneProviderCoverage, useSetZoneProvider,
  useAdminServices, useAdminProviders, type AdminZoneInput,
} from "@/lib/db/admin-queries";
import { LocationPicker, isValidLatLng } from "@/components/famio/LocationPicker";

export const Route = createFileRoute("/admin/zones")({ component: AdminZones });

type ZoneForm = {
  name_en: string;
  name_ar: string;
  center_lat: number | null;
  center_lng: number | null;
  radius_km: string;
  travel_fee: string;
};

const EMPTY_FORM: ZoneForm = { name_en: "", name_ar: "", center_lat: null, center_lng: null, radius_km: "5", travel_fee: "0" };

function formFromZone(z: any): ZoneForm {
  return {
    name_en: z.name_en ?? "",
    name_ar: z.name_ar ?? "",
    center_lat: z.center_lat ?? null,
    center_lng: z.center_lng ?? null,
    radius_km: String(z.radius_km ?? 5),
    travel_fee: String(z.travel_fee ?? 0),
  };
}

function validate(f: ZoneForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.name_en.trim()) errors.name_en = "English name is required.";
  if (!f.name_ar.trim()) errors.name_ar = "Arabic name is required.";
  if (!isValidLatLng({ lat: f.center_lat ?? NaN, lng: f.center_lng ?? NaN })) errors.center = "Set the zone's center on the map.";
  const radius = Number(f.radius_km);
  if (!Number.isFinite(radius) || radius <= 0) errors.radius_km = "Must be greater than 0.";
  const fee = Number(f.travel_fee);
  if (!Number.isFinite(fee) || fee < 0) errors.travel_fee = "Must be 0 or more.";
  return errors;
}

function toInput(f: ZoneForm, isActive: boolean): AdminZoneInput {
  return {
    name_en: f.name_en.trim(),
    name_ar: f.name_ar.trim(),
    center_lat: f.center_lat!,
    center_lng: f.center_lng!,
    radius_km: Number(f.radius_km),
    travel_fee: Number(f.travel_fee),
    is_active: isActive,
  };
}

function dbErrorMessage(e: any): string {
  return e?.message ?? "Something went wrong. Please try again.";
}

function ZoneFormFields({ form, setForm, errors }: { form: ZoneForm; setForm: (f: ZoneForm) => void; errors: Record<string, string> }) {
  return (
    <div className="space-y-3">
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
          <span className="text-xs font-semibold text-muted-foreground">Radius (km)</span>
          <input value={form.radius_km} onChange={(e) => setForm({ ...form, radius_km: e.target.value })} type="number" min={0.1} step={0.1}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.radius_km && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.radius_km}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Travel fee (EGP)</span>
          <input value={form.travel_fee} onChange={(e) => setForm({ ...form, travel_fee: e.target.value })} type="number" min={0} step={1}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
          {errors.travel_fee && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.travel_fee}</p>}
        </label>
      </div>

      <div>
        <span className="text-xs font-semibold text-muted-foreground">Zone center</span>
        <div className="mt-1 rounded-lg border border-border bg-surface p-2">
          <LocationPicker
            value={isValidLatLng({ lat: form.center_lat ?? NaN, lng: form.center_lng ?? NaN }) ? { lat: form.center_lat!, lng: form.center_lng! } : null}
            onChange={(pos) => setForm({ ...form, center_lat: pos.lat, center_lng: pos.lng })}
          />
        </div>
        {errors.center && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.center}</p>}
      </div>
    </div>
  );
}

function CoveragePanel({ zoneId }: { zoneId: string }) {
  const servicesQ = useAdminServices();
  const providersQ = useAdminProviders("verified");
  const zoneServicesQ = useZoneServiceCoverage(zoneId);
  const zoneProvidersQ = useZoneProviderCoverage(zoneId);
  const setService = useSetZoneService();
  const setProvider = useSetZoneProvider();

  const enabledServices = zoneServicesQ.data ?? new Set<string>();
  const coveredProviders = zoneProvidersQ.data ?? new Set<string>();

  return (
    <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Services in this zone</h3>
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {(servicesQ.data ?? []).map((s: any) => (
            <li key={s.id}>
              <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={enabledServices.has(s.id)}
                  onChange={(e) => setService.mutate({ zoneId, serviceId: s.id, enabled: e.target.checked }, { onError: (e2: any) => toast.error(dbErrorMessage(e2)) })}
                />
                {s.name_en}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Providers serving this zone</h3>
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {(providersQ.data ?? []).map((p: any) => (
            <li key={p.id}>
              <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={coveredProviders.has(p.id)}
                  onChange={(e) => setProvider.mutate({ zoneId, providerId: p.id, enabled: e.target.checked }, { onError: (e2: any) => toast.error(dbErrorMessage(e2)) })}
                />
                {p.profile?.full_name || p.id.slice(0, 8)}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AdminZones() {
  const q = useAdminZones();
  const create = useCreateZone();
  const update = useUpdateZone();
  const setActive = useSetZoneActive();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<ZoneForm>(EMPTY_FORM);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ZoneForm>(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [coverageZoneId, setCoverageZoneId] = useState<string | null>(null);

  const zones = q.data ?? [];

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return zones.filter((z: any) => {
      if (statusFilter === "active" && !z.is_active) return false;
      if (statusFilter === "inactive" && z.is_active) return false;
      if (!needle) return true;
      return String(z.name_en ?? "").toLowerCase().includes(needle) || String(z.name_ar ?? "").toLowerCase().includes(needle);
    });
  }, [zones, query, statusFilter]);

  const startCreate = () => {
    setEditingId(null);
    setCreateErrors({});
    setCreateForm(EMPTY_FORM);
    setCreating(true);
  };

  const submitCreate = () => {
    const errors = validate(createForm);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;
    create.mutate(toInput(createForm, true), {
      onSuccess: () => { setCreating(false); toast.success("Zone created."); },
      onError: (e: any) => toast.error(dbErrorMessage(e)),
    });
  };

  const startEdit = (z: any) => {
    setCreating(false);
    setEditErrors({});
    setEditForm(formFromZone(z));
    setEditingId(z.id);
  };

  const submitEdit = (z: any) => {
    const errors = validate(editForm);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    update.mutate({ id: z.id, ...toInput(editForm, z.is_active) }, {
      onSuccess: () => { setEditingId(null); toast.success("Zone updated."); },
      onError: (e: any) => toast.error(dbErrorMessage(e)),
    });
  };

  return (
    <div className="px-5 py-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Zones</h1>
          <p className="text-xs text-muted-foreground">Manage service coverage areas. Deactivate instead of deleting where possible.</p>
        </div>
        <button onClick={startCreate} className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-3 py-2 text-xs font-bold text-navy-foreground">
          <Plus className="h-3.5 w-3.5" /> New zone
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name…" className="w-full bg-transparent text-sm outline-none" />
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
          <h2 className="text-sm font-extrabold">New zone</h2>
          <div className="mt-4"><ZoneFormFields form={createForm} setForm={setCreateForm} errors={createErrors} /></div>
          <div className="mt-4 flex gap-2">
            <button onClick={submitCreate} disabled={create.isPending} className="rounded-lg bg-navy px-4 py-2 text-xs font-bold text-navy-foreground disabled:opacity-50">
              {create.isPending ? "Creating…" : "Create zone"}
            </button>
            <button onClick={() => setCreating(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-bold">Cancel</button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : q.isError ? (
          <p className="text-sm text-coral">Could not load zones. Please refresh.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No zones match this search/filter.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((z: any) => (
              <li key={z.id} className="rounded-xl border border-border/60 p-3">
                {editingId === z.id ? (
                  <div className="space-y-3">
                    <ZoneFormFields form={editForm} setForm={setEditForm} errors={editErrors} />
                    <div className="flex gap-2">
                      <button onClick={() => submitEdit(z)} disabled={update.isPending} className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50">
                        {update.isPending ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setEditingId(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-coral" />
                        <p className="text-sm font-semibold">{z.name_en} <span className="text-muted-foreground">/ {z.name_ar}</span></p>
                        {!z.is_active && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Inactive</span>}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{z.radius_km} km radius · {z.travel_fee} EGP travel fee</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button onClick={() => setCoverageZoneId(coverageZoneId === z.id ? null : z.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">
                        {coverageZoneId === z.id ? "Hide coverage" : "Coverage"}
                      </button>
                      <button onClick={() => startEdit(z)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Edit</button>
                      <button
                        disabled={setActive.isPending}
                        onClick={() => setActive.mutate({ id: z.id, active: !z.is_active }, { onError: (e: any) => toast.error(dbErrorMessage(e)) })}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${z.is_active ? "border border-coral text-coral" : "bg-navy text-navy-foreground"}`}
                      >
                        {z.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </div>
                )}
                {coverageZoneId === z.id && <CoveragePanel zoneId={z.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
