import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PhoneFrame, PrimaryButton } from "@/components/famio/ui";
import { CustomerPageHeader } from "@/components/famio/CustomerPageHeader";
import { customerAreaLabel } from "@/components/famio/customerAreaLabel";
import { QueryError } from "@/components/famio/QueryError";
import { useApp } from "@/lib/store";
import {
  useUpdateProfile,
  useCreateAddress,
  useUpdateAddress,
  useAddresses,
  useMyProfile,
} from "@/lib/db/queries";
import { useServiceAreasSettings } from "@/lib/db/settings-queries";
import { AuthGate } from "@/components/famio/AuthGate";
import { LocationPicker, isValidLatLng } from "@/components/famio/LocationPicker";
import { Card } from "@/components/famio/ui";
import { AlertTriangle, MapPin, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { contactPhoneErrorKey } from "@/lib/auth/oauth";
import { normalizeDigitsToWestern } from "@/lib/otp/normalizePhone";

export const Route = createFileRoute("/setup")({ component: SetupRoute });

function SetupRoute() {
  return (
    <AuthGate>
      <Setup />
    </AuthGate>
  );
}

const FIXED_CITY = "Giza";

function Setup() {
  const { profile, setProfile } = useApp();
  const nav = useNavigate();
  const { t } = useTranslation();
  const [form, setForm] = useState({ ...profile, area: "", floor: "" });
  const [existingAddressId, setExistingAddressId] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const updateProfile = useUpdateProfile();
  const createAddress = useCreateAddress();
  const updateAddress = useUpdateAddress();
  const existingAddresses = useAddresses();
  const areasQ = useServiceAreasSettings();
  const areaOptions = (areasQ.data ?? []).filter((a) => a.enabled).map((a) => a.name);
  const myProfile = useMyProfile();
  // OAuth sign-ins arrive without a phone; providers need one to reach the customer.
  const needsPhone = !!myProfile.data && !myProfile.data.phone;
  const [contactPhone, setContactPhone] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const contactPhoneDigits = normalizeDigitsToWestern(contactPhone).replace(/\D/g, "");
  const contactPhoneValid = /^(0|20)?1[0125]\d{8}$/.test(contactPhoneDigits);

  useEffect(() => {
    if (myProfile.data?.full_name) {
      setForm((f) => ({ ...f, name: myProfile.data!.full_name! }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myProfile.data?.full_name]);

  useEffect(() => {
    const list = existingAddresses.data;
    if (!list || list.length === 0) return;
    const def = list.find((a) => a.is_default) ?? list[0];
    setExistingAddressId(def.id);
    setForm((f) => ({
      ...f,
      area: def.area ?? "",
      address: def.street ?? def.line1 ?? "",
      compound: def.compound ?? "",
      building: def.building ?? "",
      floor: def.floor ?? "",
      apartment: def.apartment ?? "",
      notes: def.access_notes ?? "",
    }));
    if (isValidLatLng({ lat: def.lat ?? NaN, lng: def.lng ?? NaN })) {
      setCoords({ lat: def.lat as number, lng: def.lng as number });
    }
  }, [existingAddresses.data]);

  const update = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  const valid =
    form.name.trim().length > 1 &&
    form.address.trim().length > 2 &&
    form.area.trim().length > 0 &&
    isValidLatLng(coords) &&
    (!needsPhone || contactPhoneValid);
  const saving =
    savingPhone || updateProfile.isPending || createAddress.isPending || updateAddress.isPending;

  if (myProfile.isLoading || existingAddresses.isLoading || areasQ.isLoading) {
    return (
      <PhoneFrame bg="bg-background">
        <CustomerPageHeader title={t("setup.title")} backTo="/profile" />
        <div className="grid flex-1 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        </div>
      </PhoneFrame>
    );
  }

  if (myProfile.isError) {
    return (
      <PhoneFrame bg="bg-background">
        <CustomerPageHeader title={t("setup.title")} backTo="/profile" />
        <QueryError onRetry={() => myProfile.refetch()} />
      </PhoneFrame>
    );
  }

  if (existingAddresses.isError) {
    return (
      <PhoneFrame bg="bg-background">
        <CustomerPageHeader title={t("setup.title")} backTo="/profile" />
        <QueryError onRetry={() => existingAddresses.refetch()} />
      </PhoneFrame>
    );
  }

  const submit = async () => {
    if (!valid || saving) return;
    if (existingAddresses.isLoading) {
      await existingAddresses.refetch();
    }
    if (needsPhone) {
      setSavingPhone(true);
      const { error } = await supabase.rpc("set_my_contact_phone", { p_phone: contactPhoneDigits });
      setSavingPhone(false);
      if (error) {
        toast.error(t(contactPhoneErrorKey(error.message)));
        return;
      }
      await myProfile.refetch();
    }
    try {
      await updateProfile.mutateAsync({ full_name: form.name.trim() });

      if (existingAddressId) {
        await updateAddress.mutateAsync({
          id: existingAddressId,
          label: "home",
          street: form.address.trim(),
          compound: form.compound || undefined,
          building: form.building || undefined,
          floor: form.floor || undefined,
          apartment: form.apartment || undefined,
          access_notes: form.notes || undefined,
          area: form.area,
          city: FIXED_CITY,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        });
      } else {
        const isFirstAddress = (existingAddresses.data?.length ?? 0) === 0;
        await createAddress.mutateAsync({
          label: "home",
          street: form.address.trim(),
          compound: form.compound || undefined,
          building: form.building || undefined,
          floor: form.floor || undefined,
          apartment: form.apartment || undefined,
          access_notes: form.notes || undefined,
          area: form.area,
          city: FIXED_CITY,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          is_default: isFirstAddress,
        });
      }

      setProfile(form);
      nav({ to: "/home" });
    } catch {
      toast.error(t("setup.saveFailed"));
    }
  };

  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHeader title={t("setup.title")} backTo="/profile" />
      <div className="flex-1 space-y-5 px-6 pb-32 pt-2">
        <Field
          label={t("setup.name")}
          value={form.name}
          onChange={(v) => update("name", v)}
          placeholder={t("setup.namePlaceholder")}
        />

        {needsPhone ? (
          <div>
            <Field
              label={t("oauth.phoneLabel")}
              value={contactPhone}
              onChange={(v) => setContactPhone(v.replace(/[^\d٠-٩ +]/g, ""))}
              placeholder="01xxxxxxxxx"
            />
            <p className="mt-1.5 text-pro-12 text-muted-foreground">{t("oauth.phoneHint")}</p>
          </div>
        ) : null}

        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t("setup.area")}
          </label>
          {areasQ.isError ? (
            <div className="mt-2">
              <QueryError compact onRetry={() => areasQ.refetch()} />
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-3">
              {areaOptions.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => update("area", a)}
                  className={`focus-ring tap-scale h-14 rounded-[1.25rem] border text-sm font-extrabold transition-all ${
                    form.area === a
                      ? "border-brand bg-brand/5 text-brand"
                      : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  {customerAreaLabel(a, t)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t("setup.address")}
          </label>
          <div className="mt-2 flex items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
            <textarea
              rows={2}
              placeholder={t("setup.addressPlaceholder")}
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
              className="min-w-0 flex-1 resize-none bg-transparent text-pro-14 font-medium outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t("addresses.location", "Location on map")}
          </label>
          <Card className="mt-2 p-3">
            <LocationPicker value={coords} onChange={(pos) => setCoords(pos)} />
          </Card>
          {!isValidLatLng(coords) && (
            <p className="mt-2 flex items-start gap-1.5 text-pro-12 font-semibold text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-brand" />
              {t(
                "addresses.noCoordsWarning",
                "Without a pinned location, this address can't be used to book a service.",
              )}
            </p>
          )}
        </div>

        <Field
          label={t("setup.building")}
          value={form.building}
          onChange={(v) => update("building", v)}
          placeholder={t("setup.buildingPlaceholder")}
        />
        <Field
          label={t("addresses.floor")}
          value={form.floor}
          onChange={(v) => update("floor", v)}
          placeholder={t("addresses.floorPlaceholder")}
        />
        <Field
          label={t("setup.apartment")}
          value={form.apartment}
          onChange={(v) => update("apartment", v)}
          placeholder={t("setup.apartmentPlaceholder")}
        />
      </div>
      <div className="action-bar safe-bottom px-6 pt-4">
        <PrimaryButton onClick={submit} disabled={!valid || saving}>
          {saving ? t("common.saving", "Saving…") : t("common.continue")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 h-14 w-full rounded-[1.25rem] border border-border bg-surface px-4 text-pro-14 font-semibold outline-none focus:border-brand"
      />
    </div>
  );
}
