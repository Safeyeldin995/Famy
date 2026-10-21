import { useState } from "react";
import { View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  mergeExperiencePayload,
  mergeReferencesPayload,
  setupDateOfBirth,
  type SetupSnapshot,
} from "@shared/provider/setupHelpers";
import {
  buildReferencesPayload,
  isReferenceEmpty,
  type OnboardingReference,
} from "@shared/provider/onboardingReferences";
import type { PickedFile } from "@/lib/provider/documentUpload";
import { WeeklyHoursEditor } from "@/ui/provider/WeeklyHoursEditor";
import { hasSharedWorkingHours, type WorkingRule } from "@/lib/provider/availabilityHelpers";
import { Field, Choices, ui } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { proCard } from "./cards";
import { space } from "@/ui/theme";

const GOVERNORATE_KEYS = [
  "cairo",
  "giza",
  "alexandria",
  "qalyubia",
  "sharqia",
  "dakahlia",
  "gharbia",
  "monufia",
  "beheira",
  "kafrElsheikh",
  "damietta",
  "portSaid",
  "ismailia",
  "suez",
  "northSinai",
  "southSinai",
  "fayoum",
  "beniSuef",
  "minya",
  "assiut",
  "sohag",
  "qena",
  "luxor",
  "aswan",
  "redSea",
  "newValley",
  "matrouh",
];

const emptyReference: OnboardingReference = {
  full_name: "",
  relationship: "",
  phone: "",
  notes: "",
};

export function SetupItemForm({
  item,
  snapshot,
  references,
  rules,
  needsBabysitting,
  ageGroups,
  providerId,
  profileId,
  onSave,
}: {
  item: string;
  snapshot: SetupSnapshot;
  references: OnboardingReference[];
  rules: { weekday: number; start_time: string; end_time: string }[];
  needsBabysitting: boolean;
  ageGroups: { code: string; name_ar: string; name_en: string }[];
  providerId: string;
  profileId: string;
  onSave: (edits: Record<string, unknown>) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [years, setYears] = useState(snapshot.provider?.years_experience ?? 0);
  const [bio, setBio] = useState(
    ar ? (snapshot.provider?.bio_ar ?? "") : (snapshot.provider?.bio_en ?? ""),
  );
  const [maxChildren, setMaxChildren] = useState(snapshot.provider?.max_children_per_booking ?? 1);
  const [ages, setAges] = useState((snapshot.age_group_capabilities ?? []).map((row) => row.code));
  const [refs, setRefs] = useState([
    references[0] ?? { ...emptyReference },
    references[1] ?? { ...emptyReference },
  ]);
  const [year, month, day] = (snapshot.details?.date_of_birth ?? "").split("-");
  const [birth, setBirth] = useState({ year: year ?? "", month: month ?? "", day: day ?? "" });
  const [governorate, setGovernorate] = useState(snapshot.details?.governorate ?? "");
  const [area, setArea] = useState(snapshot.details?.area ?? "");
  const [address, setAddress] = useState(snapshot.details?.full_address ?? "");
  const [editorRules, setEditorRules] = useState<WorkingRule[]>(
    rules.map((row) => ({
      ...row,
      start_time: row.start_time.slice(0, 5),
      end_time: row.end_time.slice(0, 5),
    })),
  );
  const [sameHours, setSameHours] = useState(() => hasSharedWorkingHours(rules));

  const dob = setupDateOfBirth(birth.year, birth.month, birth.day);
  const governorateOptions = GOVERNORATE_KEYS.map((key) => ({
    value: t(`providerSetup.governorates.${key}`, { lng: "ar" }),
    label: t(`providerSetup.governorates.${key}`),
  }));

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      setFile({
        uri: a.uri,
        mimeType: a.mimeType ?? "image/jpeg",
        fileName: a.fileName,
        fileSize: a.fileSize,
      });
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (item === "photo") {
        if (file) {
          await onSave({ profilePhoto: file });
        } else if (snapshot.profile?.avatar_url) {
          router.back();
        } else {
          setError(t("providerSetup.missing.photo"));
        }
        return;
      }
      if (item === "about") {
        await onSave({
          experience: { years_experience: years, [ar ? "bio_ar" : "bio_en"]: bio },
        });
        return;
      }
      if (item === "babysitting") {
        await onSave({
          experience: {
            max_children_per_booking: maxChildren,
            age_group_capabilities: ages.map((code) => ({
              code,
              years_experience: null,
              note: null,
            })),
          },
        });
        return;
      }
      if (item === "reference") {
        const payload = buildReferencesPayload(refs[0], refs[1]);
        if (!payload.ok) {
          setError(t("providerSetup.missing.reference"));
          return;
        }
        await onSave({ references: payload.references });
        return;
      }
      if (item === "personal") {
        if (!dob || !governorate.trim() || !area.trim() || !address.trim()) {
          setError(t("providerSetup.missing.personal"));
          return;
        }
        await onSave({
          personal: {
            date_of_birth: dob,
            governorate,
            area,
            full_address: address,
          },
        });
        return;
      }
      if (item === "hours") {
        await onSave({
          rules: editorRules.map((r) => ({
            weekday: r.weekday,
            start_time: `${r.start_time.slice(0, 5)}:00`,
            end_time: `${r.end_time.slice(0, 5)}:00`,
          })),
        });
      }
    } catch {
      setError(t("providerApply.saveError"));
    } finally {
      setBusy(false);
    }
  };

  if (item === "subjects") {
    return (
      <View style={proCard.card}>
        <Text>{t("providerApply.subjects")}</Text>
        <Text tone="muted">{t("mobilePro.subjectsOnWebHint")}</Text>
        <Button
          variant="secondary"
          label={t("mobilePro.editOnWeb")}
          onPress={() => router.push("/pro-setup-home")}
        />
      </View>
    );
  }

  return (
    <View style={{ gap: space.lg }}>
      <Text tone="muted">{t(`providerSetup.hints.${item}`)}</Text>
      {item === "photo" && (
        <>
          <Button
            variant="secondary"
            label={t("providerApply.capture")}
            onPress={() => void pickPhoto()}
          />
        </>
      )}
      {item === "about" && (
        <>
          <Field
            label={t("providerSetup.years")}
            value={String(years)}
            keyboardType="number-pad"
            onChangeText={(v) => setYears(Number(v.replace(/\D/g, "")) || 0)}
          />
          <Field label={t("providerApply.about")} value={bio} multiline onChangeText={setBio} />
        </>
      )}
      {item === "babysitting" && needsBabysitting && (
        <>
          <Field
            label={t("providerSetup.maxChildren")}
            value={String(maxChildren)}
            keyboardType="number-pad"
            onChangeText={(v) => setMaxChildren(Number(v.replace(/\D/g, "")) || 1)}
          />
          <Text weight="bold">{t("providerSetup.ages")}</Text>
          <View style={ui.wrap}>
            {ageGroups.map((g) => {
              const selected = ages.includes(g.code);
              return (
                <Button
                  key={g.code}
                  variant={selected ? "primary" : "secondary"}
                  label={i18n.language === "ar" ? g.name_ar : g.name_en}
                  onPress={() =>
                    setAges((rows) =>
                      selected ? rows.filter((c) => c !== g.code) : [...rows, g.code],
                    )
                  }
                />
              );
            })}
          </View>
        </>
      )}
      {item === "reference" && (
        <>
          {[0, 1].map((index) =>
            index === 1 && isReferenceEmpty(refs[1]) && isReferenceEmpty(refs[0]) ? null : (
              <View key={index} style={proCard.card}>
                <Field
                  label={t("pro.onboardingWizard.refName")}
                  value={refs[index].full_name}
                  onChangeText={(full_name) =>
                    setRefs((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, full_name } : row)),
                    )
                  }
                />
                <Field
                  label={t("pro.onboardingWizard.refPhone")}
                  value={refs[index].phone}
                  ltr
                  keyboardType="phone-pad"
                  onChangeText={(phone) =>
                    setRefs((rows) => rows.map((row, i) => (i === index ? { ...row, phone } : row)))
                  }
                />
                <Field
                  label={t("pro.onboardingWizard.refRelationship")}
                  value={refs[index].relationship}
                  onChangeText={(relationship) =>
                    setRefs((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, relationship } : row)),
                    )
                  }
                />
              </View>
            ),
          )}
        </>
      )}
      {item === "personal" && (
        <>
          <Field
            label={t("providerSetup.year")}
            value={birth.year}
            keyboardType="number-pad"
            onChangeText={(year) => setBirth((b) => ({ ...b, year }))}
          />
          <Field
            label={t("providerSetup.month")}
            value={birth.month}
            keyboardType="number-pad"
            onChangeText={(month) => setBirth((b) => ({ ...b, month }))}
          />
          <Field
            label={t("providerSetup.day")}
            value={birth.day}
            keyboardType="number-pad"
            onChangeText={(day) => setBirth((b) => ({ ...b, day }))}
          />
          <Choices
            label={t("pro.onboardingWizard.governorate")}
            value={governorate}
            onChange={setGovernorate}
            options={governorateOptions}
          />
          <Field label={t("pro.onboardingWizard.area")} value={area} onChangeText={setArea} />
          <Field
            label={t("pro.onboardingWizard.address")}
            value={address}
            multiline
            onChangeText={setAddress}
          />
        </>
      )}
      {item === "hours" && (
        <WeeklyHoursEditor
          value={editorRules}
          onChange={setEditorRules}
          sameHours={sameHours}
          onSameHoursChange={setSameHours}
        />
      )}
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button label={t("common.save")} loading={busy} onPress={() => void save()} />
    </View>
  );
}
