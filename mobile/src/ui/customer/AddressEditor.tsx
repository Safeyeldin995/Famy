import { isValidLatLng } from "@shared/geo/latLng";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import * as Location from "expo-location";
import { useTranslation } from "react-i18next";
import {
  useBookingConfig,
  useCreateAddress,
  useUpdateAddress,
  type AddressInput,
} from "@/lib/bookingQueries";
import { useAddresses, useMyProfile, useUpdateCustomerName } from "@/lib/queries";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { Page, QueryState, Choices, Field, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
export function AddressEditor({
  addressId,
  setup = false,
}: {
  addressId?: string;
  setup?: boolean;
}) {
  const { t } = useTranslation();
  const areas = useBookingConfig<{ areas: { name: string; enabled: boolean }[] }>("service_areas");
  const save = useCreateAddress();
  const updateAddress = useUpdateAddress();
  const updateName = useUpdateCustomerName();
  const addresses = useAddresses();
  const profile = useMyProfile();
  const [name, setName] = useState("");
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
  const [locating, setLocating] = useState(false);
  const [details, setDetails] = useState(false);
  const set = (key: keyof AddressInput, v: AddressInput[keyof AddressInput]) =>
    setValue((s) => ({ ...s, [key]: v }));
  async function locate() {
    setLocating(true);
    setError("");
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (!p.granted) {
        setError(t("mobileBooking.locationDenied"));
        return;
      }
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setValue((v) => ({ ...v, lat: result.coords.latitude, lng: result.coords.longitude }));
    } catch {
      setError(t("mobileBooking.locationFailed"));
    } finally {
      setLocating(false);
    }
  }
  async function submit() {
    const valid =
      value.street.trim().length > 1 &&
      !!value.area?.trim() &&
      isValidLatLng({ lat: value.lat ?? NaN, lng: value.lng ?? NaN }) &&
      (value.label !== "other" || !!value.custom_label?.trim());
    if (!valid || (setup && name.trim().length < 2) || (addressId && !existing)) {
      setError(t("mobileBooking.addressRequired"));
      return;
    }
    setError("");
    try {
      if (setup) await updateName.mutateAsync(name);
      if (existing) await updateAddress.mutateAsync({ ...value, id: existing.id });
      else
        await save.mutateAsync({
          ...value,
          is_default: !addresses.data?.length || value.is_default,
        });
      router.replace(setup ? "/home" : "/addresses");
    } catch {
      setError(t("common.somethingWentWrong"));
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
        />
      }
      queries={[areas, addresses, profile]}
      footer={
        <Button
          label={t("common.save")}
          loading={save.isPending || updateAddress.isPending || updateName.isPending}
          disabled={
            areas.isLoading ||
            areas.isError ||
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
        onChange={(v) => set("area", v)}
        options={(areas.data?.areas ?? [])
          .filter((a) => a.enabled)
          .map((a) => ({
            value: a.name,
            label:
              a.name === "Sheikh Zayed"
                ? t("customerAreas.sheikhZayed")
                : a.name === "6th of October"
                  ? t("customerAreas.october")
                  : a.name,
          }))}
      />
      {(["street", "compound", "building", "floor", "apartment"] as const).map((key) => (
        <Field
          key={key}
          label={t(
            key === "street"
              ? "setup.address"
              : key === "floor"
                ? "addresses.floor"
                : `setup.${key}`,
          )}
          value={value[key] || ""}
          onChangeText={(v) => set(key, v)}
        />
      ))}
      <View style={ui.card}>
        <Text>{t("mobileBooking.locationPermission")}</Text>
        <Button
          label={t("mobileBooking.useLocation")}
          loading={locating}
          onPress={() => void locate()}
        />
        {value.lat != null && (
          <Text style={ui.ltr}>{`${value.lat.toFixed(5)}, ${value.lng?.toFixed(5)}`}</Text>
        )}
      </View>
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
      {error && <Text tone="danger">{error}</Text>}
    </Page>
  );
}
