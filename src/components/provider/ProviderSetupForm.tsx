import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera } from "lucide-react";
import { SetupScreen } from "@/components/famio/SetupScreen";
import { NumberStepper } from "@/components/famio/NumberStepper";
import { CheckChip } from "@/components/famio/CheckChip";
import { TextField } from "@/components/famio/TextField";
import { BottomSheetSelect } from "@/components/famio/BottomSheetSelect";
import {
  buildReferencesPayload,
  isReferenceEmpty,
  type OnboardingReference,
} from "@/lib/provider/onboardingReferences";
import {
  setupDateOfBirth,
  type SetupSnapshot,
  type WorkingRule,
} from "@/lib/provider/setupHelpers";

export const setupItems = [
  "photo",
  "about",
  "babysitting",
  "subjects",
  "reference",
  "personal",
  "hours",
] as const;
export type SetupItem = (typeof setupItems)[number];
export type SetupEdits = {
  file?: File;
  experience?: {
    years_experience?: number;
    bio_ar?: string;
    bio_en?: string;
    max_children_per_booking?: number;
    age_group_capabilities?: {
      code: string;
      years_experience: number | null;
      note: string | null;
    }[];
  };
  references?: { index: number; value: Partial<OnboardingReference> }[];
  personal?: { date_of_birth: string; governorate: string; area: string; full_address: string };
  rules?: WorkingRule[];
};
const emptyReference: OnboardingReference = {
  full_name: "",
  relationship: "",
  phone: "",
  notes: "",
};
const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const governorates = [
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
export function ProviderSetupForm({
  item,
  snapshot,
  references = [],
  rules = [],
  ageGroups = [],
  avatarUrl,
  onSave,
  onBack,
}: {
  item: Exclude<SetupItem, "subjects">;
  snapshot: SetupSnapshot;
  references?: OnboardingReference[];
  rules?: WorkingRule[];
  ageGroups?: { code: string; name_ar: string; name_en: string }[];
  avatarUrl?: string | null;
  onSave: (edits: SetupEdits) => Promise<void>;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File>();
  const [photo, setPhoto] = useState(avatarUrl);
  useEffect(() => {
    if (!file) {
      setPhoto(avatarUrl);
      return;
    }
    const url = URL.createObjectURL(file);
    setPhoto(url);
    return () => URL.revokeObjectURL(url);
  }, [file, avatarUrl]);
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
  const [refEdits, setRefEdits] = useState<NonNullable<SetupEdits["references"]>>([]);
  const [second, setSecond] = useState(!isReferenceEmpty(refs[1]));
  const [year, month, day] = (snapshot.details?.date_of_birth ?? "").split("-");
  const [birth, setBirth] = useState({ year: year ?? "", month: month ?? "", day: day ?? "" });
  const [governorate, setGovernorate] = useState(snapshot.details?.governorate ?? "");
  const [area, setArea] = useState(snapshot.details?.area ?? "");
  const [address, setAddress] = useState(snapshot.details?.full_address ?? "");
  const [hours, setHours] = useState<WorkingRule[]>(
    rules.map((row) => ({
      ...row,
      start_time: row.start_time.slice(0, 5),
      end_time: row.end_time.slice(0, 5),
    })),
  );
  const dob = setupDateOfBirth(birth.year, birth.month, birth.day);
  const valid =
    item === "photo"
      ? !!file || !!snapshot.profile?.avatar_url
      : item === "about"
        ? !!(bio.trim() || (ar ? snapshot.provider?.bio_en : snapshot.provider?.bio_ar)?.trim()) &&
          years >= 0 &&
          years <= 40
        : item === "babysitting"
          ? ages.length > 0 && maxChildren >= 1 && maxChildren <= 6
          : item === "reference"
            ? buildReferencesPayload(refs[0], refs[1]).ok
            : item === "personal"
              ? !!dob && !!governorate.trim() && !!area.trim() && !!address.trim()
              : hours.length > 0 && hours.every((r) => r.start_time < r.end_time);
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const edits: SetupEdits =
        item === "photo"
          ? { file }
          : item === "about"
            ? { experience: { years_experience: years, [ar ? "bio_ar" : "bio_en"]: bio } }
            : item === "babysitting"
              ? {
                  experience: {
                    max_children_per_booking: maxChildren,
                    age_group_capabilities: ages.map((code) => {
                      const saved = snapshot.age_group_capabilities?.find(
                        (row) => row.code === code,
                      );
                      return {
                        code,
                        years_experience: saved?.years_experience ?? null,
                        note: saved?.note ?? null,
                      };
                    }),
                  },
                }
              : item === "reference"
                ? { references: refEdits }
                : item === "personal"
                  ? { personal: { date_of_birth: dob!, governorate, area, full_address: address } }
                  : { rules: hours };
      await onSave(edits);
    } catch {
      setError(t("providerApply.saveError"));
    } finally {
      setBusy(false);
    }
  };
  const changeRef = (index: number, key: keyof OnboardingReference, value: string) => {
    setRefs((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
    setRefEdits((rows) => [
      ...rows.filter((row) => row.index !== index),
      { index, value: { ...rows.find((row) => row.index === index)?.value, [key]: value } },
    ]);
  };
  const numbers = (start: number, length: number) =>
    Array.from({ length }, (_, i) => ({ value: String(start + i), label: String(start + i) }));
  const dateOptions = {
    day: numbers(1, 31),
    month: numbers(1, 12),
    year: numbers(new Date().getFullYear() - 100, 83).reverse(),
  };
  const governorateOptions = governorates.map((key) => ({
    value: t(`providerSetup.governorates.${key}`, { lng: "ar" }),
    label: t(`providerSetup.governorates.${key}`),
  }));
  if (governorate && !governorateOptions.some((o) => o.value === governorate))
    governorateOptions.unshift({ value: governorate, label: governorate });
  return (
    <SetupScreen
      title={t(`providerSetup.titles.${item}`)}
      hint={t(`providerSetup.hints.${item}`)}
      onBack={onBack}
      onSave={() => void save()}
      disabled={!valid}
      busy={busy}
      error={error}
      missing={!valid ? t(`providerSetup.missing.${item}`) : undefined}
    >
      <fieldset disabled={busy} className="contents">
        {item === "photo" && (
          <div className="grid justify-items-center gap-4">
            <div className="grid h-40 w-40 place-items-center overflow-hidden rounded-full bg-surface-2">
              {photo ? (
                <img
                  src={photo}
                  alt={t("providerApply.photo")}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Camera size={48} />
              )}
            </div>
            <label className="apply-capture relative">
              <span>
                <Camera size={16} />
                {t("providerApply.capture")}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png"
                aria-label={t("providerApply.capture")}
                className="absolute inset-0 opacity-0"
                onChange={(e) => {
                  const next = e.target.files?.[0];
                  if (!next) return;
                  if (!/\.(jpe?g|png)$/i.test(next.name) || next.size > 10 * 1024 * 1024) {
                    setError(t("pro.onboardingWizard.uploadError"));
                    return;
                  }
                  setFile(next);
                  setError("");
                }}
              />
            </label>
          </div>
        )}
        {item === "about" && (
          <>
            <NumberStepper
              value={years}
              min={0}
              max={40}
              unitLabel={t("providerSetup.years")}
              onChange={setYears}
            />
            <label>
              <span className="apply-label">{t("providerApply.about")}</span>
              <textarea
                className="apply-input !h-28 py-3"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
            </label>
            <p className="apply-label">{t("providerSetup.phrases")}</p>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4].map((index) => (
                <CheckChip
                  key={index}
                  selected={false}
                  onClick={() =>
                    setBio((value) =>
                      [value.trim(), t(`providerSetup.bioPhrases.p${index}`)]
                        .filter(Boolean)
                        .join(" "),
                    )
                  }
                >
                  {t(`providerSetup.bioPhrases.p${index}`)}
                </CheckChip>
              ))}
            </div>
          </>
        )}
        {item === "babysitting" && (
          <>
            <NumberStepper
              value={maxChildren}
              min={1}
              max={6}
              unitLabel={t("providerSetup.children")}
              onChange={setMaxChildren}
            />
            <div className="flex flex-wrap gap-2">
              {ageGroups.map((row) => {
                const locked = snapshot.age_group_capabilities?.some(
                  (c) => c.code === row.code && (c.verified_at || c.verified_by),
                );
                return (
                  <CheckChip
                    key={row.code}
                    selected={ages.includes(row.code)}
                    disabled={!!locked}
                    onClick={() =>
                      setAges((current) =>
                        current.includes(row.code)
                          ? current.filter((c) => c !== row.code)
                          : [...current, row.code],
                      )
                    }
                  >
                    {ar ? row.name_ar : row.name_en}
                  </CheckChip>
                );
              })}
            </div>
          </>
        )}
        {item === "reference" && (
          <>
            {refs.slice(0, second ? 2 : 1).map((row, index) => (
              <div key={index} className="grid gap-4">
                <TextField
                  label={t("pro.onboardingWizard.refName")}
                  value={row.full_name}
                  onChange={(e) => changeRef(index, "full_name", e.target.value)}
                />
                <BottomSheetSelect
                  label={t("pro.onboardingWizard.refRelationship")}
                  value={row.relationship}
                  options={[
                    ...new Set(
                      [
                        row.relationship,
                        "former_client",
                        "colleague",
                        "neighbor",
                        "friend",
                        "relative",
                      ].filter(Boolean),
                    ),
                  ].map((value) => ({
                    value,
                    label: t(`providerSetup.relationships.${value}`, { defaultValue: value }),
                  }))}
                  onChange={(value) => changeRef(index, "relationship", value)}
                />
                <TextField
                  label={t("pro.onboardingWizard.refPhone")}
                  type="tel"
                  value={row.phone}
                  onChange={(e) => changeRef(index, "phone", e.target.value)}
                />
              </div>
            ))}
            {!second && (
              <button
                type="button"
                className="min-h-11 text-start font-bold text-brand"
                onClick={() => setSecond(true)}
              >
                {t("providerSetup.secondReference")}
              </button>
            )}
          </>
        )}
        {item === "personal" && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {(["day", "month", "year"] as const).map((key) => (
                <BottomSheetSelect
                  key={key}
                  label={t(`providerSetup.${key}`)}
                  value={birth[key] ? String(Number(birth[key])) : ""}
                  options={dateOptions[key]}
                  onChange={(value) => setBirth((current) => ({ ...current, [key]: value }))}
                />
              ))}
            </div>
            <BottomSheetSelect
              label={t("pro.onboardingWizard.governorate")}
              value={governorate}
              options={governorateOptions}
              onChange={setGovernorate}
            />
            <TextField
              label={t("pro.onboardingWizard.area")}
              value={area}
              onChange={(e) => setArea(e.target.value)}
            />
            <TextField
              label={t("pro.onboardingWizard.address")}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </>
        )}
        {item === "hours" && (
          <>
            <div className="flex flex-wrap gap-2">
              {[6, 0, 1, 2, 3, 4, 5].map((weekday) => (
                <CheckChip
                  key={weekday}
                  selected={hours.some((r) => r.weekday === weekday)}
                  onClick={() =>
                    setHours((rows) =>
                      rows.some((r) => r.weekday === weekday)
                        ? rows.filter((r) => r.weekday !== weekday)
                        : [...rows, { weekday, start_time: "09:00", end_time: "17:00" }],
                    )
                  }
                >
                  {t(`pro.schedule.days.${dayKeys[weekday]}`)}
                </CheckChip>
              ))}
            </div>
            {hours.map((row, index) => (
              <div key={`${row.weekday}-${index}`} className="grid gap-2">
                <p className="apply-label">{t(`pro.schedule.days.${dayKeys[row.weekday]}`)}</p>
                <div className="grid grid-cols-2 gap-3">
                  {(["start_time", "end_time"] as const).map((key) => {
                    const values = [
                      ...new Set([
                        ...Array.from(
                          { length: key === "end_time" ? 25 : 24 },
                          (_, h) => `${String(h).padStart(2, "0")}:00`,
                        ),
                        row[key],
                      ]),
                    ].sort();
                    return (
                      <BottomSheetSelect
                        key={key}
                        label={t(key === "start_time" ? "pro.schedule.start" : "pro.schedule.end")}
                        value={row[key]}
                        options={values.map((value) => ({
                          value,
                          label: value === "24:00" ? t("packages.endOfDay") : value,
                        }))}
                        onChange={(value) =>
                          setHours((rows) =>
                            rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
                          )
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </fieldset>
    </SetupScreen>
  );
}
