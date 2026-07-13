import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Home, Briefcase, Users, MapPin, Star, AlertTriangle, Loader2 } from "lucide-react";
import { PrimaryButton, Card } from "@/components/famio/ui";
import { LocationPicker, isValidLatLng } from "@/components/famio/LocationPicker";
import { useServiceAreasSettings } from "@/lib/db/settings-queries";
import type { AddressInput, AddressLabel } from "@/lib/db/queries";

const FIXED_CITY = "Giza";

const LABELS: { key: AddressLabel; icon: typeof Home }[] = [
  { key: "home", icon: Home },
  { key: "work", icon: Briefcase },
  { key: "family", icon: Users },
  { key: "other", icon: MapPin },
];

export type AddressFormValue = {
  label: AddressLabel;
  customLabel: string;
  area: string;
  street: string;
  building: string;
  floor: string;
  apartment: string;
  compound: string;
  landmark: string;
  accessNotes: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
};

export function emptyAddressFormValue(): AddressFormValue {
  return {
    label: "home",
    customLabel: "",
    area: "",
    street: "",
    building: "",
    floor: "",
    apartment: "",
    compound: "",
    landmark: "",
    accessNotes: "",
    lat: null,
    lng: null,
    isDefault: false,
  };
}

export function AddressForm({
  value,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  showDefaultToggle = true,
}: {
  value: AddressFormValue;
  onChange: (v: AddressFormValue) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  showDefaultToggle?: boolean;
}) {
  const { t } = useTranslation();
  const areasQ = useServiceAreasSettings();
  const areaOptions = (areasQ.data ?? []).filter((a) => a.enabled).map((a) => a.name);
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof AddressFormValue>(k: K, v: AddressFormValue[K]) => onChange({ ...value, [k]: v });

  const valid =
    value.street.trim().length > 1 &&
    value.area.trim().length > 0 &&
    (value.label !== "other" || value.customLabel.trim().length > 0);

  const submit = () => {
    setTouched(true);
    if (!valid || submitting) return;
    onSubmit();
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("addresses.labelField", "Label")}
        </label>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {LABELS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => set("label", key)}
              className={`flex flex-col items-center gap-1.5 rounded-2xl border py-3 text-[11px] font-bold transition-all ${
                value.label === key ? "border-navy bg-navy/[0.04] text-navy" : "border-border bg-surface text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(`addresses.label.${key}`)}
            </button>
          ))}
        </div>
        {value.label === "other" && (
          <input
            value={value.customLabel}
            onChange={(e) => set("customLabel", e.target.value)}
            placeholder={t("addresses.customLabelPlaceholder", "e.g. Grandma's house")}
            className="mt-2 h-12 w-full rounded-2xl border border-border bg-surface px-4 text-sm font-medium outline-none focus:border-navy"
          />
        )}
        {touched && value.label === "other" && value.customLabel.trim().length === 0 && (
          <p className="mt-1 text-[11px] font-semibold text-coral">{t("validation.required")}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("setup.area")}</label>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {areaOptions.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => set("area", a)}
              className={`h-14 rounded-2xl border text-sm font-semibold transition-all ${
                value.area === a ? "border-navy bg-navy/[0.04] text-navy" : "border-border bg-surface text-muted-foreground"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        {touched && !value.area && <p className="mt-1 text-[11px] font-semibold text-coral">{t("validation.required")}</p>}
      </div>

      <Field label={t("setup.address")} value={value.street} onChange={(v) => set("street", v)} placeholder={t("setup.addressPlaceholder")} />
      {touched && value.street.trim().length < 2 && <p className="-mt-3 text-[11px] font-semibold text-coral">{t("validation.required")}</p>}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("setup.compound")} value={value.compound} onChange={(v) => set("compound", v)} placeholder={t("setup.compoundPlaceholder")} />
        <Field label={t("setup.building")} value={value.building} onChange={(v) => set("building", v)} placeholder={t("setup.buildingPlaceholder")} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("addresses.floor", "Floor")} value={value.floor} onChange={(v) => set("floor", v)} placeholder={t("addresses.floorPlaceholder", "e.g. 3rd")} />
        <Field label={t("setup.apartment")} value={value.apartment} onChange={(v) => set("apartment", v)} placeholder={t("setup.apartmentPlaceholder")} />
      </div>
      <Field label={t("addresses.landmark", "Nearby landmark")} value={value.landmark} onChange={(v) => set("landmark", v)} placeholder={t("addresses.landmarkPlaceholder", "Optional")} />

      <div>
        <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("setup.notes")}</label>
        <textarea
          rows={2}
          placeholder={t("setup.notesPlaceholder")}
          value={value.accessNotes}
          onChange={(e) => set("accessNotes", e.target.value)}
          className="mt-2 w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-[15px] outline-none focus:border-navy"
        />
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("addresses.location", "Location on map")}</label>
        <Card className="mt-2 p-3">
          <LocationPicker
            value={isValidLatLng({ lat: value.lat ?? NaN, lng: value.lng ?? NaN }) ? { lat: value.lat!, lng: value.lng! } : null}
            onChange={(pos) => onChange({ ...value, lat: pos.lat, lng: pos.lng })}
          />
        </Card>
        {!isValidLatLng({ lat: value.lat ?? NaN, lng: value.lng ?? NaN }) && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-coral" />
            {t("addresses.noCoordsWarning", "Without a pinned location, this address can't be used to book a service.")}
          </p>
        )}
      </div>

      {showDefaultToggle && (
        <button
          type="button"
          onClick={() => set("isDefault", !value.isDefault)}
          className="flex w-full items-center justify-between rounded-2xl bg-surface px-4 py-3.5 shadow-soft"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <Star className={`h-4 w-4 ${value.isDefault ? "fill-coral text-coral" : "text-muted-foreground"}`} />
            {t("addresses.setAsDefault", "Set as default address")}
          </span>
          <span
            className={`grid h-6 w-11 items-center rounded-full px-0.5 transition-all ${value.isDefault ? "justify-end bg-navy" : "justify-start bg-border"}`}
          >
            <span className="h-5 w-5 rounded-full bg-white shadow" />
          </span>
        </button>
      )}

      <PrimaryButton onClick={submit} disabled={submitting}>
        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : submitLabel}
      </PrimaryButton>
    </div>
  );
}

export function addressFormValueToInput(v: AddressFormValue): AddressInput {
  return {
    label: v.label,
    custom_label: v.label === "other" ? v.customLabel.trim() : null,
    city: FIXED_CITY,
    area: v.area || null,
    street: v.street.trim(),
    building: v.building.trim() || null,
    floor: v.floor.trim() || null,
    apartment: v.apartment.trim() || null,
    compound: v.compound.trim() || null,
    landmark: v.landmark.trim() || null,
    access_notes: v.accessNotes.trim() || null,
    lat: v.lat,
    lng: v.lng,
    is_default: v.isDefault,
  };
}

export function addressRowToFormValue(row: any): AddressFormValue {
  return {
    label: (row.label ?? "other") as AddressLabel,
    customLabel: row.custom_label ?? "",
    area: row.area ?? "",
    street: row.street ?? row.line1 ?? "",
    building: row.building ?? "",
    floor: row.floor ?? "",
    apartment: row.apartment ?? "",
    compound: row.compound ?? "",
    landmark: row.landmark ?? "",
    accessNotes: row.access_notes ?? "",
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    isDefault: !!row.is_default,
  };
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
