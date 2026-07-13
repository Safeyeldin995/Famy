import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { PhoneFrame, PrimaryButton, TopBar, Avatar } from "@/components/famio/ui";
import { useApp } from "@/lib/store";
import { useUpdateProfile, useCreateAddress, useUpdateAddress, useAddresses, useMyProfile, useAvatarUrl } from "@/lib/db/queries";
import { useServiceAreasSettings } from "@/lib/db/settings-queries";
import { supabase } from "@/integrations/supabase/client";
import { Camera, MapPin, Loader2 } from "lucide-react";

export const Route = createFileRoute("/setup")({ component: Setup });

const FIXED_CITY = "Giza";

function Setup() {
  const { profile, setProfile } = useApp();
  const nav = useNavigate();
  const { t } = useTranslation();
  const [form, setForm] = useState({ ...profile, area: "" });
  const [existingAddressId, setExistingAddressId] = useState<string | null>(null);
  const updateProfile = useUpdateProfile();
  const createAddress = useCreateAddress();
  const updateAddress = useUpdateAddress();
  const existingAddresses = useAddresses();
  const areasQ = useServiceAreasSettings();
  const areaOptions = (areasQ.data ?? []).filter((a) => a.enabled).map((a) => a.name);
  const myProfile = useMyProfile();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const avatarQ = useAvatarUrl(myProfile.data?.avatar_url as string | undefined);

  useEffect(() => {
    if (myProfile.data?.full_name) {
      setForm((f) => ({ ...f, name: myProfile.data!.full_name! }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myProfile.data?.full_name]);

  useEffect(() => {
    const list = existingAddresses.data;
    if (!list || list.length === 0) return;
    const def = list.find((a: any) => a.is_default) ?? list[0];
    setExistingAddressId(def.id);
    setForm((f) => ({
      ...f,
      area: def.area ?? "",
      address: def.street ?? def.line1 ?? "",
      compound: def.compound ?? "",
      building: def.building ?? "",
      apartment: def.apartment ?? "",
      notes: def.access_notes ?? "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingAddresses.data]);

  const onPickAvatar = async (file: File) => {
    try {
      setUploading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("auth required");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id);
      if (dbErr) throw dbErr;
      await qc.invalidateQueries({ queryKey: ["my-profile"] });
    } catch (e: any) {
      toast.error(e?.message ?? t("setup.uploadFailed", "Could not upload photo."));
    } finally {
      setUploading(false);
    }
  };

  const update = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  const valid = form.name.trim().length > 1 && form.address.trim().length > 2 && form.area.trim().length > 0;
  const saving = updateProfile.isPending || createAddress.isPending || updateAddress.isPending;

  const submit = async () => {
    if (!valid || saving) return;
    if (existingAddresses.isLoading) {
      await existingAddresses.refetch();
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
          apartment: form.apartment || undefined,
          access_notes: form.notes || undefined,
          area: form.area,
          city: FIXED_CITY,
        });
      } else {
        const isFirstAddress = (existingAddresses.data?.length ?? 0) === 0;
        await createAddress.mutateAsync({
          label: "home",
          street: form.address.trim(),
          compound: form.compound || undefined,
          building: form.building || undefined,
          apartment: form.apartment || undefined,
          access_notes: form.notes || undefined,
          area: form.area,
          city: FIXED_CITY,
          is_default: isFirstAddress,
        });
      }

      setProfile(form);
      nav({ to: "/home" });
    } catch (e: any) {
      toast.error(e?.message ?? t("setup.saveFailed", "Could not save your profile."));
    }
  };

  return (
    <PhoneFrame bg="bg-surface">
      <TopBar back={{ to: "/profile" }} title={t("setup.title")} />
      <div className="flex-1 space-y-5 px-6 pb-6 pt-2">
        <div className="flex flex-col items-center pb-2">
          <div className="relative">
            {avatarQ.data ? (
              <Avatar src={avatarQ.data} className="h-24 w-24 rounded-full" />
            ) : (
              <div className="grid h-24 w-24 place-items-center rounded-full bg-navy/10 text-3xl font-extrabold text-navy">
                {form.name ? form.name.charAt(0).toUpperCase() : "F"}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full bg-coral text-coral-foreground shadow-card disabled:opacity-60"
              aria-label={t("setup.photoHint")}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickAvatar(f);
                e.target.value = "";
              }}
            />
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
