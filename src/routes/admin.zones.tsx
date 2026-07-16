import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Plus, Search, MapPin } from "lucide-react";
import {
  useAdminZones, useCreateZone, useUpdateZone, useSetZoneActive,
  useCheckZoneOverlap, useTestPointInZone,
  useZoneServiceCoverage, useSetZoneService, useZoneProviderCoverage, useSetZoneProvider,
  useAdminServices, useAdminProviders, type AdminZoneInput,
} from "@/lib/db/admin-queries";
import { LocationPicker, isValidLatLng } from "@/components/famio/LocationPicker";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { ZonePolygonEditor, type LatLng, type OtherZone } from "@/components/famio/ZonePolygonEditor";

export const Route = createFileRoute("/admin/zones")({ component: AdminZones });

type BoundaryType = "polygon" | "circle";

type ZoneForm = {
  name_en: string;
  name_ar: string;
  boundary_type: BoundaryType;
  polygon: LatLng[];
  center_lat: number | null;
  center_lng: number | null;
  radius_km: string;
  travel_fee: string;
};

const EMPTY_FORM: ZoneForm = {
  name_en: "", name_ar: "", boundary_type: "polygon", polygon: [],
  center_lat: null, center_lng: null, radius_km: "5", travel_fee: "0",
};

function formFromZone(z: any): ZoneForm {
  return {
    name_en: z.name_en ?? "",
    name_ar: z.name_ar ?? "",
    boundary_type: z.boundary_type === "circle" ? "circle" : "polygon",
    polygon: Array.isArray(z.polygon) ? z.polygon : [],
    center_lat: z.center_lat ?? null,
    center_lng: z.center_lng ?? null,
    radius_km: String(z.radius_km ?? 5),
    travel_fee: String(z.travel_fee ?? 0),
  };
}

function toOtherZone(z: any): OtherZone | null {
  if (z.boundary_type === "polygon" && Array.isArray(z.polygon) && z.polygon.length >= 3) {
    return { id: z.id, label: z.name_en, boundary_type: "polygon", polygon: z.polygon };
  }
  if (z.boundary_type !== "polygon" && isValidLatLng({ lat: z.center_lat, lng: z.center_lng }) && z.radius_km) {
    return { id: z.id, label: z.name_en, boundary_type: "circle", center: { lat: z.center_lat, lng: z.center_lng }, radiusKm: Number(z.radius_km) };
  }
  return null;
}

function validate(f: ZoneForm, t: (key: string) => string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.name_en.trim()) errors.name_en = t("admin.cancellationReasons.nameEnRequired");
  if (!f.name_ar.trim()) errors.name_ar = t("admin.cancellationReasons.nameArRequired");
  const fee = Number(f.travel_fee);
  if (!Number.isFinite(fee) || fee < 0) errors.travel_fee = t("admin.services.mustBeZeroOrMore");
  if (f.boundary_type === "polygon") {
    if (f.polygon.length < 3) errors.polygon = t("admin.zones.polygonTooFewPoints");
  } else {
    if (!isValidLatLng({ lat: f.center_lat ?? NaN, lng: f.center_lng ?? NaN })) errors.center = t("admin.zones.setCenter");
    const radius = Number(f.radius_km);
    if (!Number.isFinite(radius) || radius <= 0) errors.radius_km = t("admin.services.mustBeGreaterThanZero");
  }
  return errors;
}

function toInput(f: ZoneForm, isActive: boolean): AdminZoneInput {
  const base = { name_en: f.name_en.trim(), name_ar: f.name_ar.trim(), travel_fee: Number(f.travel_fee), is_active: isActive };
  if (f.boundary_type === "polygon") {
    return { ...base, boundary_type: "polygon", polygon: f.polygon, center_lat: null, center_lng: null, radius_km: null };
  }
  return { ...base, boundary_type: "circle", polygon: null, center_lat: f.center_lat!, center_lng: f.center_lng!, radius_km: Number(f.radius_km) };
}

function dbErrorMessage(e: any, t: (key: string) => string): string {
  return e?.message ?? t("admin.cancellationReasons.genericError");
}

function OverlapWarning({ polygon, excludeZoneId }: { polygon: LatLng[]; excludeZoneId?: string }) {
  const { t } = useTranslation();
  const check = useCheckZoneOverlap();
  useEffect(() => {
    if (polygon.length < 3) return;
    check.mutate({ polygon, excludeZoneId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(polygon), excludeZoneId]);

  if (!check.data || check.data.length === 0) return null;
  const names = check.data.map((z: any) => z.name_en).join(", ");
  return (
    <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800">
      {t("admin.zones.overlapWarning", { names })}
    </p>
  );
}

function AddressTestTool({ zone }: { zone: any }) {
  const { t } = useTranslation();
  const [point, setPoint] = useState<LatLng | null>(null);
  const test = useTestPointInZone();

  const run = (pos: LatLng) => {
    setPoint(pos);
    test.mutate({ lat: pos.lat, lng: pos.lng });
  };

  const inside = test.data ? test.data.zone_id === zone.id : test.data === null ? false : null;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("admin.zones.testAddress")}</h3>
      <p className="mt-1 text-[11px] text-muted-foreground">{t("admin.zones.testAddressHint")}</p>
      <div className="mt-2">
        <LocationPicker value={point} onChange={run} />
      </div>
      {point && test.isSuccess && (
        <p className={`mt-2 text-xs font-bold ${inside ? "text-emerald-600" : "text-coral"}`}>
          {inside ? t("admin.zones.testResultInside") : t("admin.zones.testResultOutside")}
        </p>
      )}
    </div>
  );
}

function ZoneFormFields({ form, setForm, errors, otherZones, excludeZoneId }: {
  form: ZoneForm; setForm: (f: ZoneForm) => void; errors: Record<string, string>;
  otherZones: OtherZone[]; excludeZoneId?: string;
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

      <div>
        <span className="text-xs font-semibold text-muted-foreground">{t("admin.zones.boundaryType")}</span>
        <div className="mt-1 flex gap-1 rounded-xl border border-border bg-surface p-1">
          {(["polygon", "circle"] as const).map((bt) => (
            <button key={bt} type="button" onClick={() => setForm({ ...form, boundary_type: bt })}
              className={`focus-ring flex-1 rounded-lg px-3 py-1.5 text-xs font-bold ${form.boundary_type === bt ? "bg-navy text-navy-foreground" : "text-muted-foreground"}`}>
              {bt === "polygon" ? t("admin.zones.polygonMode") : t("admin.zones.circleMode")}
            </button>
          ))}
        </div>
      </div>

      <label className="block max-w-[160px]">
        <span className="text-xs font-semibold text-muted-foreground">{t("admin.zones.travelFee")}</span>
        <input value={form.travel_fee} onChange={(e) => setForm({ ...form, travel_fee: e.target.value })} type="number" min={0} step={1}
          className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
        {errors.travel_fee && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.travel_fee}</p>}
      </label>

      {form.boundary_type === "polygon" ? (
        <div>
          <ZonePolygonEditor
            polygon={form.polygon}
            onChange={(pts) => setForm({ ...form, polygon: pts })}
            otherZones={otherZones}
          />
          {errors.polygon && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.polygon}</p>}
          <OverlapWarning polygon={form.polygon} excludeZoneId={excludeZoneId} />
        </div>
      ) : (
        <>
          <label className="block max-w-[160px]">
            <span className="text-xs font-semibold text-muted-foreground">{t("admin.zones.radiusKm")}</span>
            <input value={form.radius_km} onChange={(e) => setForm({ ...form, radius_km: e.target.value })} type="number" min={0.1} step={0.1}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
            {errors.radius_km && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.radius_km}</p>}
          </label>
          <div>
            <span className="text-xs font-semibold text-muted-foreground">{t("admin.zones.zoneCenter")}</span>
            <div className="mt-1 rounded-lg border border-border bg-surface p-2">
              <LocationPicker
                value={isValidLatLng({ lat: form.center_lat ?? NaN, lng: form.center_lng ?? NaN }) ? { lat: form.center_lat!, lng: form.center_lng! } : null}
                onChange={(pos) => setForm({ ...form, center_lat: pos.lat, center_lng: pos.lng })}
              />
            </div>
            {errors.center && <p className="mt-1 text-[11px] font-semibold text-coral">{errors.center}</p>}
          </div>
        </>
      )}
    </div>
  );
}

function CoveragePanel({ zoneId }: { zoneId: string }) {
  const { t } = useTranslation();
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
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("admin.zones.servicesInZone")}</h3>
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {(servicesQ.data ?? []).map((s: any) => (
            <li key={s.id}>
              <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={enabledServices.has(s.id)}
                  disabled={setService.isPending}
                  onChange={(e) => setService.mutate({ zoneId, serviceId: s.id, enabled: e.target.checked }, { onError: (e2: any) => toast.error(dbErrorMessage(e2, t)) })}
                />
                {s.name_en}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("admin.zones.providersInZone")}</h3>
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {(providersQ.data ?? []).map((p: any) => (
            <li key={p.id}>
              <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={coveredProviders.has(p.id)}
                  disabled={setProvider.isPending}
                  onChange={(e) => setProvider.mutate({ zoneId, providerId: p.id, enabled: e.target.checked }, { onError: (e2: any) => toast.error(dbErrorMessage(e2, t)) })}
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
  const { t } = useTranslation();
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
  const allOtherZones = useMemo(() => zones.map(toOtherZone).filter((z): z is OtherZone => z != null), [zones]);

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
    const errors = validate(createForm, t);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;
    create.mutate(toInput(createForm, true), {
      onSuccess: () => { setCreating(false); toast.success(t("admin.zones.created")); },
      onError: (e: any) => toast.error(dbErrorMessage(e, t)),
    });
  };

  const startEdit = (z: any) => {
    setCreating(false);
    setEditErrors({});
    setEditForm(formFromZone(z));
    setEditingId(z.id);
  };

  const submitEdit = (z: any) => {
    const errors = validate(editForm, t);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    update.mutate({ id: z.id, ...toInput(editForm, z.is_active) }, {
      onSuccess: () => { setEditingId(null); toast.success(t("admin.zones.updated")); },
      onError: (e: any) => toast.error(dbErrorMessage(e, t)),
    });
  };

  return (
    <div className="px-5 py-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("admin.layout.nav.zones")}</h1>
          <p className="text-xs text-muted-foreground">{t("admin.zones.subtitle")}</p>
        </div>
        <button onClick={startCreate} className="focus-ring inline-flex items-center gap-1.5 rounded-xl bg-navy px-3 py-2 text-xs font-bold text-navy-foreground">
          <Plus className="h-3.5 w-3.5" /> {t("admin.zones.newZone")}
        </button>
      </div>

      {!creating && !editingId && allOtherZones.length > 0 && (
        <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
          <h2 className="text-sm font-extrabold">{t("admin.zones.overviewTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("admin.zones.overviewHint")}</p>
          <div className="mt-3">
            <ZonePolygonEditor polygon={[]} onChange={() => {}} otherZones={allOtherZones} />
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.zones.searchPlaceholder")} className="w-full bg-transparent text-sm outline-none" />
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
          <h2 className="text-sm font-extrabold">{t("admin.zones.newZoneTitle")}</h2>
          <div className="mt-4"><ZoneFormFields form={createForm} setForm={setCreateForm} errors={createErrors} otherZones={allOtherZones} /></div>
          <div className="mt-4 flex gap-2">
            <button onClick={submitCreate} disabled={create.isPending} className="focus-ring rounded-lg bg-navy px-4 py-2 text-xs font-bold text-navy-foreground disabled:opacity-50">
              {create.isPending ? t("admin.cancellationReasons.creating") : t("admin.zones.createZone")}
            </button>
            <button onClick={() => setCreating(false)} className="focus-ring rounded-lg border border-border px-4 py-2 text-xs font-bold">{t("common.cancel")}</button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : q.isError ? (
          <AdminQueryError message={t("admin.zones.loadError")} error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.zones.noResults")}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((z: any) => (
              <li key={z.id} className="rounded-xl border border-border/60 p-3">
                {editingId === z.id ? (
                  <div className="space-y-3">
                    <ZoneFormFields form={editForm} setForm={setEditForm} errors={editErrors} otherZones={allOtherZones.filter((o) => o.id !== z.id)} excludeZoneId={z.id} />
                    <div className="flex gap-2">
                      <button onClick={() => submitEdit(z)} disabled={update.isPending} className="focus-ring rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50">
                        {update.isPending ? t("admin.cancellationReasons.saving") : t("common.save")}
                      </button>
                      <button onClick={() => setEditingId(null)} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-bold">{t("common.cancel")}</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-coral" />
                        <p className="text-sm font-semibold">{z.name_en} <span className="text-muted-foreground">/ {z.name_ar}</span></p>
                        {!z.is_active && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{t("admin.cancellationReasons.inactive")}</span>}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {z.boundary_type === "polygon"
                          ? t("admin.zones.polygonMode")
                          : t("admin.zones.radiusAndFee", { radius: z.radius_km, fee: z.travel_fee })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button onClick={() => setCoverageZoneId(coverageZoneId === z.id ? null : z.id)} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">
                        {coverageZoneId === z.id ? t("admin.zones.hideCoverage") : t("admin.zones.coverage")}
                      </button>
                      <button onClick={() => startEdit(z)} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">{t("common.edit")}</button>
                      <button
                        disabled={setActive.isPending}
                        onClick={() => setActive.mutate({ id: z.id, active: !z.is_active }, { onError: (e: any) => toast.error(dbErrorMessage(e, t)) })}
                        className={`focus-ring rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${z.is_active ? "border border-coral text-coral" : "bg-navy text-navy-foreground"}`}
                      >
                        {z.is_active ? t("admin.cancellationReasons.deactivate") : t("admin.cancellationReasons.activate")}
                      </button>
                    </div>
                  </div>
                )}
                {coverageZoneId === z.id && (
                  <>
                    <CoveragePanel zoneId={z.id} />
                    <AddressTestTool zone={z} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
