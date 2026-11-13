import { isValidLatLng } from "@shared/geo/latLng";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  useActiveZones,
  useBookingConfig,
  useCreateAddress,
  useUpdateAddress,
  type AddressInput,
} from "@/lib/bookingQueries";
import { useAddresses, useMyProfile } from "@/lib/queries";
import { useSaveCustomerSetup } from "@/lib/customerSetup";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { Page, QueryState, Choices, Field, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { LocationPicker } from "./LocationPicker";
import { AreaComingSoonCard } from "./AreaComingSoonCard";
import { normalizeDigitsToWestern } from "@shared/otp/normalizePhone";
import { contactPhoneErrorKey } from "@shared/auth/oauthShared";
import {
  areaNameForZone,
  zoneCenter,
  zoneForAreaName,
  zoneForPoint,
} from "@shared/geo/serviceZones";
import { useToast } from "@/ui/Toast";
import { space } from "@/ui/theme";
export function AddressEditor({
  addressId,
  setup = false,
  onSaved,
  onClose,
}: {
  addressId?: string;
  setup?: boolean;
  onSaved?: (id: string) => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const areas = useBookingConfig<{ areas: { name: string; enabled: boolean }[] }>("service_areas");
  const zones = useActiveZones();
  const save = useCreateAddress();
  const updateAddress = useUpdateAddress();
  const saveSetup = useSaveCustomerSetup();
  const addresses = useAddresses();
  const profile = useMyProfile();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const needsPhone = setup && !!profile.data && !profile.data.phone;
  const phoneDigits = normalizeDigitsToWestern(phone).replace(/\D/g, "");
  const initialized = useRef(false);
  const existing = setup
    ? (addresses.data?.find((a) => a.is_default) ?? addresses.data?.[0])
    : addresses.data?.find((a) => a.id === addressId);
  useEffect(() => {
    if (initialized.current || !addresses.isSuccess || (setup && !profile.isSuccess)) return;
    initialized.current = true;
    setName(profile.data?.full_name ?? "");
    if (existing)
      setValue({
        ...existing,
        label: existing.label as AddressInput["label"],
        street: existing.street ?? existing.line1 ?? "",
      });
  }, [addresses.isSuccess, profile.isSuccess, profile.data, setup, existing]);
  const [value, setValue] = useState<AddressInput>({
    label: "home",
    city: "Giza",
    street: "",
    area: "",
    lat: null,
    lng: null,
  });
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  const set = (key: keyof AddressInput, v: AddressInput[keyof AddressInput]) =>
    setValue((s) => ({ ...s, [key]: v }));
  const areaNames = (areas.data?.areas ?? []).filter((a) => a.enabled).map((a) => a.name);
  const areaLabel = (name: string) =>
    name === "Sheikh Zayed"
      ? t("customerAreas.sheikhZayed")
      : name === "6th of October"
        ? t("customerAreas.october")
        : name;
  const pin = isValidLatLng({ lat: value.lat ?? NaN, lng: value.lng ?? NaN })
    ? { lat: value.lat!, lng: value.lng! }
    : null;
  const pinZone = pin && zones.data ? zoneForPoint(pin, zones.data) : null;
  const pinOutside = !!pin && !!zones.data && !pinZone;
  const chosenZone = value.area && zones.data ? zoneForAreaName(value.area, zones.data) : null;
  const mapFocus = chosenZone ? zoneCenter(chosenZone) : null;
  // The pin decides the area: moving it into another zone switches the area.
  const setPin = (pos: { lat: number; lng: number }) => {
    const zone = zones.data ? zoneForPoint(pos, zones.data) : null;
    const area = zone ? areaNameForZone(zone, areaNames) : null;
    setValue((v) => ({ ...v, ...pos, area: area ?? v.area }));
  };
  // Picking an area moves the map there; a pin left in another area is cleared.
  const chooseArea = (area: string) => {
    const zone = zones.data ? zoneForAreaName(area, zones.data) : null;
    setValue((v) => {
      const keepPin =
        !zone ||
        !isValidLatLng({ lat: v.lat ?? NaN, lng: v.lng ?? NaN }) ||
        zoneForPoint({ lat: v.lat!, lng: v.lng! }, zones.data ?? [])?.id === zone.id;
      return keepPin ? { ...v, area } : { ...v, area, lat: null, lng: null };
    });
  };
  async function submit() {
    const valid =
      value.street.trim().length > 2 &&
      !!value.area?.trim() &&
      isValidLatLng({ lat: value.lat ?? NaN, lng: value.lng ?? NaN }) &&
      (value.label !== "other" || !!value.custom_label?.trim());
    if (
      !valid ||
      (setup && name.trim().length < 2) ||
      (needsPhone && !/^(0|20)?1[0125]\d{8}$/.test(phoneDigits)) ||
      (addressId && !existing)
    ) {
      setError(t("mobileBooking.addressRequired"));
      return;
    }
    if (pinOutside) {
      setError(t("addresses.outsideServiceArea"));
      return;
    }
    setError("");
    try {
      let savedId: string;
      if (setup)
        savedId = await saveSetup.mutateAsync({
          name,
          address: value,
          addressId: existing?.id,
          contactPhone: needsPhone ? phoneDigits : undefined,
        });
      else if (existing)
        savedId = (await updateAddress.mutateAsync({ ...value, id: existing.id })).id;
      else
        savedId = (
          await save.mutateAsync({
            ...value,
            is_default: !addresses.data?.length || value.is_default,
          })
        ).id;
      if (onSaved) onSaved(savedId);
      else {
        toast.show(t("addresses.saved"));
        router.replace(setup ? "/home" : "/addresses");
      }
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error ? String(error.message) : "";
      setError(
        t(/PHONE_/.test(message) ? contactPhoneErrorKey(message) : "common.somethingWentWrong"),
      );
    }
  }
  return (
    <Page
      title={t(
        setup ? "setup.title" : addressId ? "addresses.editAddress" : "addresses.addAddress",
      )}
      header={
        <CustomerPageHeader
          title={t(
            setup ? "setup.title" : addressId ? "addresses.editAddress" : "addresses.addAddress",
          )}
          backTo={setup ? "/profile" : "/addresses"}
          onBack={onClose}
        />
      }
      queries={[areas, zones, addresses, profile]}
      contentStyle={{
        paddingHorizontal: space.xxl,
        paddingTop: setup ? space.sm : space.lg,
        gap: space.xl,
      }}
      footer={
        <Button
          label={t(setup ? "common.continue" : "common.save")}
          loading={save.isPending || updateAddress.isPending || saveSetup.isPending}
          disabled={
            areas.isLoading ||
            areas.isError ||
            zones.isLoading ||
            zones.isError ||
            addresses.isLoading ||
            addresses.isError ||
            profile.isLoading ||
            profile.isError ||
            (!!addressId && !existing)
          }
          onPress={() => void submit()}
        />
      }
    >
      <QueryState query={areas} />
      <QueryState query={addresses} />
      {setup ? (
        <Field
          label={t("setup.name")}
          placeholder={t("setup.namePlaceholder")}
          value={name}
          onChangeText={setName}
        />
      ) : null}
      {needsPhone && (
        <View style={{ gap: 6 }}>
          <Field
            label={t("oauth.phoneLabel")}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <Text size="xs" tone="muted">
            {t("oauth.phoneHint")}
          </Text>
        </View>
      )}
      {!setup && (
        <Choices
          label={t("addresses.labelField")}
          value={value.label}
          onChange={(v) => set("label", v)}
          options={["home", "work", "family", "other"].map((v) => ({
            value: v,
            label: t(`addresses.label.${v}`),
          }))}
        />
      )}
      {value.label === "other" && (
        <Field
          label={t("addresses.customLabelPlaceholder")}
          value={value.custom_label || ""}
          onChangeText={(v) => set("custom_label", v)}
        />
      )}
      <Choices
        layout="grid"
        label={t("setup.area")}
        value={value.area || ""}
        onChange={chooseArea}
        options={areaNames.map((name) => ({ value: name, label: areaLabel(name) }))}
      />
      <Field
        label={t("setup.address")}
        placeholder={t("setup.addressPlaceholder")}
        value={value.street}
        onChangeText={(v) => set("street", v)}
        multiline={setup}
      />
      {setup ? (
        <View style={{ gap: 8 }}>
          <Text size="xs" weight="bold" tone="muted">
            {t("addresses.location")}
          </Text>
          <LocationPicker value={pin} focus={mapFocus} zones={zones.data} onChange={setPin} />
          {pinOutside && pin ? (
            <AreaComingSoonCard pin={pin} />
          ) : pinZone && value.area ? (
            <Text size="xs" tone="muted">
              {t("addresses.pinInArea", { area: areaLabel(value.area) })}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ flexDirection: setup ? "column" : "row", flexWrap: "wrap", gap: 12 }}>
        {(setup
          ? (["building", "floor", "apartment"] as const)
          : (["compound", "building", "floor", "apartment"] as const)
        ).map((key) => (
          <View key={key} style={setup ? undefined : { flexBasis: "47%", flexGrow: 1 }}>
            <Field
              label={t(key === "floor" ? "addresses.floor" : `setup.${key}`)}
              placeholder={t(
                key === "floor" ? "addresses.floorPlaceholder" : `setup.${key}Placeholder`,
              )}
              value={value[key] || ""}
              onChangeText={(v) => set(key, v)}
            />
          </View>
        ))}
      </View>
      {!setup ? (
        <View style={{ gap: 8 }}>
          <Text size="xs" weight="bold" tone="muted">
            {t("addresses.location")}
          </Text>
          <LocationPicker value={pin} focus={mapFocus} zones={zones.data} onChange={setPin} />
          {pinOutside && pin ? (
            <AreaComingSoonCard pin={pin} />
          ) : pinZone && value.area ? (
            <Text size="xs" tone="muted">
              {t("addresses.pinInArea", { area: areaLabel(value.area) })}
            </Text>
          ) : null}
        </View>
      ) : null}
      {!setup && (
        <>
          <Button
            variant="secondary"
            label={t("customerSetup.arrivalDetails")}
            onPress={() => setDetails(!details)}
          />
          {details && (
            <>
              <Field
                label={t("addresses.landmark")}
                value={value.landmark || ""}
                onChangeText={(v) => set("landmark", v)}
              />
              <Field
                label={t("setup.notes")}
                value={value.access_notes || ""}
                onChangeText={(v) => set("access_notes", v)}
                multiline
              />
            </>
          )}
          <Choices
            label={t("mobile.defaultAddress")}
            value={value.is_default ? "yes" : "no"}
            onChange={(v) => set("is_default", v === "yes")}
            options={[
              { value: "yes", label: t("mobileBooking.yes") },
              { value: "no", label: t("mobileBooking.no") },
            ]}
          />
        </>
      )}
      {error && <Text tone="danger">{error}</Text>}
    </Page>
  );
}
