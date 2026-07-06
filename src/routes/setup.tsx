import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PhoneFrame, PrimaryButton, TopBar } from "@/components/famio/ui";
import { useApp } from "@/lib/store";
import { useUpdateProfile, useCreateAddress, useAddresses } from "@/lib/db/queries";
import { useServiceAreasSettings } from "@/lib/db/settings-queries";
import { Camera, MapPin } from "lucide-react";

export const Route = createFileRoute("/setup")({ component: Setup });

// Real service areas now come from Settings (admin-editable); the two names
// below are only the fallback used by useServiceAreasSettings() itself if no
// `service_areas` settings row exists yet — see settings-queries.ts.
const FIXED_CITY = "Giza";

function Setup() {
  const { profile, setProfile } = useApp();
  const nav = useNavigate();
  const { t } = useTranslation();
  const [form, setForm] = useState({ ...profile, area: "" });
  const updateProfile = useUpdateProfile();
  const createAddress = useCreateAddress();
  const existingAddresses = useAddresses();
  const areasQ = useServiceAreasSettings();
  const areaOptions = (areasQ.data ?? []).filter((a) => a.enabled).map((a) => a.name);

  const update = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  const valid = form.name.trim().length > 1 && form.address.trim().length > 2 && form.area.trim().length > 0;
  const saving = updateProfile.isPending || createAddress.isPending;

  const submit = async () => {
    if (!valid || saving) return;
    // Guard against a false-positive `is_default` if this query hasn't
    // resolved yet — refetch rather than trusting a possibly-stale/absent cache.
    if (existingAddresses.isLoading) {
      await existingAddresses.refetch();
    }
    try {
      // full_name → profiles (identity data, per Sprint 1 Phase 2 scope).
      await updateProfile.mutateAsync({ full_name: form.name.trim() });

      // address → addresses (existing table; no schema changes).
      // `area` now holds the Sheikh Zayed / 6th of October selection, so
      // `compound` (a free-text sub-neighborhood, e.g. "Allegria") has no
      // dedicated column left — folded into line2 alongside apartment/
      // building/notes, same treatment as notes already had.
      const line2Parts = [form.compound, form.apartment, form.building, form.notes].filter((v) => v.trim().length > 0);
      const isFirstAddress = (existingAddresses.data?.length ?? 0) === 0;
      await createAddress.mutateAsync({
        label: "Home",
        line1: form.address.trim(),
        line2: line2Parts.length > 0 ? line2Parts.join(" · ") : undefined,
        area: form.area,
        city: FIXED_CITY,
        country: "EG",
        is_default: isFirstAddress,
      });

      // Keep Zustand's profile cache in sync for any screen still reading it
      // (e.g. the avatar-initial display) — not a source of truth anymore,
      // just a local display cache.
      setProfile(form);
      nav({ to: "/home" });
    } catch (e: any) {
      toast.error(e?.message ?? t("setup.saveFailed", "Could not save your profile."));
    }
  };

  return (
    <PhoneFrame bg="bg-surface">
      <TopBar title={t("setup.title")} />
      <div className="flex-1 space-y-5 px-6 pb-6 pt-2">
        <div className="flex flex-col items-center pb-2">
          <div className="relative">
            <div className="grid h-24 w-24 place-items-center rounded-full bg-navy/10 text-3xl font-extrabold text-navy">
              {form.name ? form.name.charAt(0).toUpperCase() : "F"}
            </div>
            <button className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full bg-coral text-coral-foreground shadow-card" aria-label={t("setup.photoHint")}>
              <Camera className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t("setup.photoHint")}</p>
        </div>

        <Field label={t("setup.name")} value={form.name} onChange={(v) => update("name", v)} placeholder={t("setup.namePlaceholder")} />

        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("setup.area")}</label>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {areaOptions.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => update("area", a)}
                className={`h-14 rounded-2xl border text-sm font-semibold transition-all ${
                  form.area === a ? "border-navy bg-navy/[0.04] text-navy" : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        <Field label={t("setup.compound")} value={form.compound} onChange={(v) => update("compound", v)} placeholder={t("setup.compoundPlaceholder")} />
        <Field label={t("setup.building")} value={form.building} onChange={(v) => update("building", v)} placeholder={t("setup.buildingPlaceholder")} />
        <Field label={t("setup.apartment")} value={form.apartment} onChange={(v) => update("apartment", v)} placeholder={t("setup.apartmentPlaceholder")} />

        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("setup.address")}</label>
          <div className="mt-2 flex items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-coral" />
            <textarea
              rows={2}
              placeholder={t("setup.addressPlaceholder")}
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
              className="min-w-0 flex-1 resize-none bg-transparent text-[15px] font-medium outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("setup.notes")}</label>
          <textarea
            rows={2}
            placeholder={t("setup.notesPlaceholder")}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            className="mt-2 w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-[15px] outline-none focus:border-navy"
          />
        </div>
      </div>
      <div className="safe-bottom border-t border-border bg-surface px-6 pt-4">
        <PrimaryButton onClick={submit} disabled={!valid || saving}>
          {saving ? t("common.saving", "Saving…") : t("common.continue")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 h-14 w-full rounded-2xl border border-border bg-surface px-4 text-[15px] font-medium outline-none focus:border-navy"
      />
    </div>
  );
}

