import { Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Search, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { useAddresses, useMarketplaceServices, Provider } from "@/lib/queries";
import { localized } from "@/lib/presentation";
import { isFixedPackage, packageLabel } from "@shared/pricing/servicePackages";
import {
  type TeachingCapabilityOption,
  formatTeachingCapabilityLine,
} from "@shared/tutoring/teachingCapabilities";
import { Page, QueryState } from "../Page";
import { Text } from "../Text";
import { Button } from "../Button";
import { CustomerPageHeader } from "../CustomerPageHeader";
import { BottomSheetSelect } from "../provider/BottomSheetSelect";
import { ProviderCard } from "../ProviderCard";
import { colors, fonts } from "../theme";
import { CustomerChips, CustomerEmpty, customerStyle } from "./Primitives";

type Props = {
  term: string;
  setTerm: (v: string) => void;
  filter: string;
  setFilter: (v: string) => void;
  serviceId: string;
  setServiceId: (v: string) => void;
  addressId: string;
  setAddressId: (v: string) => void;
  addresses: ReturnType<typeof useAddresses>;
  services: ReturnType<typeof useMarketplaceServices>;
  results: Provider[];
  capabilities: TeachingCapabilityOption[];
  providers: { isLoading: boolean; isError: boolean; refetch: () => Promise<unknown> };
};
export function CustomerSearchView(p: Props) {
  const { t, i18n } = useTranslation();
  const recovery = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center" }}>
      <Button
        variant="ghost"
        label={t("bookingUx.clearFilters")}
        onPress={() => {
          p.setTerm("");
          p.setFilter("all");
          p.setServiceId("");
        }}
      />
      <Button
        variant="ghost"
        label={t("bookingUx.changeArea")}
        onPress={() => router.push("/addresses")}
      />
      <Button
        variant="ghost"
        label={t("addresses.addAddress")}
        onPress={() => router.push("/addresses/new")}
      />
    </View>
  );
  return (
    <Page
      title={t("search.title")}
      header={
        <CustomerPageHeader
          title={t("search.title")}
          subtitle={t("home.headline")}
          backTo="/home"
        />
      }
      queries={[p.addresses, p.services, p.providers]}
      contentStyle={{ paddingTop: 16, gap: 20 }}
    >
      <View style={[customerStyle.card, customerStyle.row, { padding: 12 }]}>
        <View style={[customerStyle.icon, { borderRadius: 18, backgroundColor: colors.brand }]}>
          <Search size={20} color="white" />
        </View>
        <TextInput
          accessibilityLabel={t("search.title")}
          placeholder={t("customerSearch.placeholder")}
          placeholderTextColor={colors.muted}
          value={p.term}
          onChangeText={p.setTerm}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 44,
            fontFamily: fonts[i18n.language === "ar" ? "ar" : "en"].bold,
            fontSize: 14,
            color: colors.foreground,
            textAlign: i18n.language === "ar" ? "right" : "left",
          }}
        />
        {!!p.term && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
            onPress={() => p.setTerm("")}
            style={[
              customerStyle.icon,
              { width: 44, height: 44, backgroundColor: colors.surface2 },
            ]}
          >
            <X size={16} color={colors.muted} />
          </Pressable>
        )}
      </View>
      <CustomerChips
        value={p.filter}
        onChange={p.setFilter}
        options={[
          { value: "all", label: t("common.seeAll") },
          { value: "babysitting", label: t("categories.kidsTitle") },
          { value: "tutoring", label: t("categories.tutorTitle") },
          { value: "top", label: t("category.sortTop") },
        ]}
      />
      <View style={[customerStyle.card, customerStyle.row, { alignItems: "flex-start" }]}>
        <BottomSheetSelect
          label={t("search2.service")}
          value={p.serviceId}
          onChange={p.setServiceId}
          options={[
            { value: "", label: t("search2.allServices") },
            ...(p.services.data ?? []).map((s) => ({
              value: s.id,
              label:
                localized(s, i18n.language) +
                (isFixedPackage(s) ? ` · ${t(packageLabel(s).key, packageLabel(s).values)}` : ""),
            })),
          ]}
        />
        <BottomSheetSelect
          label={t("search2.address")}
          value={p.addressId}
          onChange={p.setAddressId}
          options={(p.addresses.data ?? []).map((a) => ({
            value: a.id,
            label: a.area || a.city || "",
          }))}
        />
      </View>
      {p.services.isError && <QueryState query={p.services} />}
      {p.addresses.isError && <QueryState query={p.addresses} />}
      {!p.providers.isLoading && !p.providers.isError && p.results.length > 0 && (
        <Text weight="heavy">
          {t("customerSearch.results", {
            value: new Intl.NumberFormat("en").format(p.results.length),
          })}
        </Text>
      )}
      {!p.addresses.isLoading && !p.addressId ? (
        <CustomerEmpty
          Icon={Search}
          title={t("customerHome.chooseArea")}
          body={t("customerHome.addressHint")}
        >
          <Button
            variant="ghost"
            label={t("addresses.addAddress")}
            onPress={() => router.push("/addresses/new")}
          />
        </CustomerEmpty>
      ) : p.providers.isLoading || p.providers.isError ? (
        <QueryState query={p.providers} />
      ) : !p.results.length ? (
        <CustomerEmpty
          Icon={Search}
          title={t("search2.noResults")}
          body={t("search2.noResultsBody")}
        >
          {recovery}
        </CustomerEmpty>
      ) : (
        <View style={{ gap: 10 }}>
          {p.results.map((provider) => {
            const cap = p.capabilities.find((row) => row.providerId === provider.id);
            const subtitle =
              p.filter === "tutoring" && cap
                ? formatTeachingCapabilityLine({
                    subject: i18n.language === "ar" ? cap.subjectNameAr : cap.subjectNameEn,
                    curriculum:
                      i18n.language === "ar" ? cap.curriculumNameAr : cap.curriculumNameEn,
                    level: i18n.language === "ar" ? cap.levelNameAr : cap.levelNameEn,
                    durationMin: cap.durationMin,
                    price: cap.price,
                  })
                : undefined;
            return <ProviderCard key={provider.id} provider={provider} subtitle={subtitle} />;
          })}
        </View>
      )}
    </Page>
  );
}
