import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  useBillingSettings, useUpdateBillingSettings,
  useServiceAreasSettings, useUpdateServiceAreasSettings,
  usePlatformContent, useUpdatePlatformContent, type PlatformContentKey,
} from "@/lib/db/settings-queries";
import {
  useAdminCategories, useSetCategoryActive, useUpdateCategoryNames,
} from "@/lib/db/admin-queries";
import { useInstapayReceiver, useUpdateInstapayReceiver } from "@/lib/db/payment-queries";
import { toast } from "sonner";
import { Save, Check } from "lucide-react";

export const Route = createFileRoute("/admin/settings")({ component: AdminSettings });

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
      <h2 className="text-sm font-extrabold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function SaveButton({ onClick, pending, saved }: { onClick: () => void; pending: boolean; saved: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-navy-foreground disabled:opacity-50"
    >
      {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
      {pending ? "Saving…" : saved ? "Saved" : "Save"}
    </button>
  );
}

function useSavedFlash(pending: boolean) {
  const [saved, setSaved] = useState(false);
  const wasPending = useState(() => ({ prev: false }))[0];
  useEffect(() => {
    if (wasPending.prev && !pending) {
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 1800);
      return () => clearTimeout(t);
    }
    wasPending.prev = pending;
  }, [pending]);
  return saved;
}

function BillingSection() {
  const q = useBillingSettings();
  const update = useUpdateBillingSettings();
  const [vat, setVat] = useState("");
  const [fee, setFee] = useState("");
  const saved = useSavedFlash(update.isPending);

  useEffect(() => {
    if (q.data) { setVat(String(q.data.vat_percent)); setFee(String(q.data.platform_fee)); }
  }, [q.data]);

  const receiverQ = useInstapayReceiver();
  const updateReceiver = useUpdateInstapayReceiver();
  const [handle, setHandle] = useState("");
  const savedReceiver = useSavedFlash(updateReceiver.isPending);
  useEffect(() => { if (receiverQ.data?.handle) setHandle(receiverQ.data.handle); }, [receiverQ.data]);

  return (
    <SectionCard title="Payments" subtitle="These values are read directly by the booking flow — no hardcoded fallback is used once this is saved.">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">VAT (%)</span>
          <input value={vat} onChange={(e) => setVat(e.target.value)} type="number" min={0} max={100} step={0.1}
            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Platform fee (EGP, flat)</span>
          <input value={fee} onChange={(e) => setFee(e.target.value)} type="number" min={0} step={1}
            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
        </label>
      </div>
      <SaveButton
        pending={update.isPending}
        saved={saved}
        onClick={() => update.mutate({ vat_percent: Number(vat) || 0, platform_fee: Number(fee) || 0 }, {
          onError: (e: any) => toast.error(e?.message ?? "Could not save billing settings"),
        })}
      />

      <div className="mt-4 border-t border-border/60 pt-4">
        <span className="text-xs font-semibold text-muted-foreground">InstaPay receiving handle</span>
        <input value={handle} onChange={(e) => setHandle(e.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" dir="ltr" />
        <div className="mt-2">
          <SaveButton pending={updateReceiver.isPending} saved={savedReceiver} onClick={() => updateReceiver.mutate({ handle }, {
            onError: (e: any) => toast.error(e?.message ?? "Could not save InstaPay handle"),
          })} />
        </div>
      </div>
    </SectionCard>
  );
}

function CategoriesSection() {
  const q = useAdminCategories();
  const setActive = useSetCategoryActive();
  const updateNames = useUpdateCategoryNames();
  const [editing, setEditing] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");

  return (
    <SectionCard title="Categories" subtitle="Enable/disable or rename service categories.">
      {q.isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
      ) : q.isError ? (
        <p className="text-sm text-coral">Could not load categories. Please refresh.</p>
      ) : (
        <ul className="space-y-2">
          {(q.data ?? []).map((c: any) => (
            <li key={c.id} className="rounded-xl border border-border/60 p-3">
              {editing === c.id ? (
                <div className="space-y-2">
                  <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="English name"
                    className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
                  <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="Arabic name" dir="rtl"
                    className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        updateNames.mutate({ id: c.id, name_en: nameEn, name_ar: nameAr }, {
                          onError: (e: any) => toast.error(e?.message ?? "Could not save category"),
                        });
                        setEditing(null);
                      }}
                      className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground"
                    >Save</button>
                    <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{c.name_en} <span className="text-muted-foreground">/ {c.name_ar}</span></p>
                    <p className="text-[11px] text-muted-foreground">{c.slug}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => { setEditing(c.id); setNameEn(c.name_en); setNameAr(c.name_ar); }}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold"
                    >Edit</button>
                    <button
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: c.id, active: !c.is_active }, {
                        onError: (e: any) => toast.error(e?.message ?? "Could not update category"),
                      })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${c.is_active ? "border border-coral text-coral" : "bg-navy text-navy-foreground"}`}
                    >
                      {c.is_active ? "Disable" : "Enable"}
                    </button>
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
  const q = useServiceAreasSettings();
  const update = useUpdateServiceAreasSettings();
  const [areas, setAreas] = useState<{ name: string; enabled: boolean }[]>([]);
  const saved = useSavedFlash(update.isPending);
  useEffect(() => { if (q.data) setAreas(q.data); }, [q.data]);

  const toggle = (name: string) => {
    const next = areas.map((a) => (a.name === name ? { ...a, enabled: !a.enabled } : a));
    setAreas(next);
    update.mutate(next, { onError: (e: any) => toast.error(e?.message ?? "Could not update service area") });
  };

  return (
    <SectionCard title="Service Areas" subtitle="Cities/districts customers and providers can select during onboarding.">
      {q.isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
      ) : q.isError ? (
        <p className="text-sm text-coral">Could not load service areas. Please refresh.</p>
      ) : (
        <ul className="space-y-2">
          {areas.map((a) => (
            <li key={a.name} className="flex items-center justify-between rounded-xl border border-border/60 p-3">
              <span className="text-sm font-semibold">{a.name}</span>
              <button
                onClick={() => toggle(a.name)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${a.enabled ? "border border-coral text-coral" : "bg-navy text-navy-foreground"}`}
              >
                {a.enabled ? "Disable" : "Enable"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {saved && <p className="text-xs font-semibold text-success">Saved</p>}
    </SectionCard>
  );
}

const CONTENT_KEYS: { key: PlatformContentKey; label: string }[] = [
  { key: "terms", label: "Terms & Conditions" },
  { key: "privacy", label: "Privacy Policy" },
  { key: "about", label: "About Famy" },
  { key: "contact", label: "Contact Information" },
];

function ContentEditor({ contentKey, label }: { contentKey: PlatformContentKey; label: string }) {
  const q = usePlatformContent(contentKey);
  const update = useUpdatePlatformContent();
  const [en, setEn] = useState("");
  const [ar, setAr] = useState("");
  const saved = useSavedFlash(update.isPending);
  useEffect(() => { if (q.data) { setEn(q.data.body_en); setAr(q.data.body_ar); } }, [q.data]);

  return (
    <div className="rounded-xl border border-border/60 p-3">
      <p className="text-sm font-semibold">{label}</p>
      {q.isLoading ? (
        <div className="mt-2 h-24 animate-pulse rounded-lg bg-muted" />
      ) : (
        <>
          <textarea value={en} onChange={(e) => setEn(e.target.value)} rows={4} placeholder="English content…"
            className="mt-2 w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
          <textarea value={ar} onChange={(e) => setAr(e.target.value)} rows={4} dir="rtl" placeholder="محتوى بالعربي…"
            className="mt-2 w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
        </>
      )}
      <div className="mt-2">
        <SaveButton pending={update.isPending} saved={saved} onClick={() => update.mutate({ key: contentKey, body_en: en, body_ar: ar }, {
          onError: (e: any) => toast.error(e?.message ?? "Could not save content"),
        })} />
      </div>
    </div>
  );
}

function PlatformContentSection() {
  return (
    <SectionCard title="Platform Content" subtitle="Bilingual static content shown to customers and providers.">
      <div className="space-y-3">
        {CONTENT_KEYS.map((c) => <ContentEditor key={c.key} contentKey={c.key} label={c.label} />)}
      </div>
    </SectionCard>
  );
}

function AdminSettings() {
  return (
    <div className="px-5 py-5 space-y-4">
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Settings</h1>
        <p className="text-xs text-muted-foreground">Platform configuration — changes here have real, immediate effect on the app.</p>
      </div>
      <BillingSection />
      <CategoriesSection />
      <ServiceAreasSection />
      <PlatformContentSection />
    </div>
  );
}
