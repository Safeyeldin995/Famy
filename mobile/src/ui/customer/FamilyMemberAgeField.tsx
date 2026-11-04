import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { memberAgeFromDate, memberAgeToDate, memberMaxYears } from "@shared/familyMemberAge";
import { BottomSheetSelect } from "../provider/BottomSheetSelect";
import { Text } from "../Text";

export function FamilyMemberAgeField({
  value,
  relationship,
  onChange,
}: {
  value: string;
  relationship: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const age = memberAgeFromDate(value);
  const options = (max: number) =>
    Array.from({ length: max + 1 }, (_, n) => ({ value: String(n), label: String(n) }));
  return (
    <View style={{ gap: 8 }}>
      <Text weight="bold">{t("memberAge.label")}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <BottomSheetSelect
          label={t("memberAge.years")}
          value={age ? String(age.years) : ""}
          options={options(memberMaxYears(relationship))}
          onChange={(years) =>
            onChange(memberAgeToDate({ years: Number(years), months: age?.months ?? 0 }))
          }
        />
        {age && age.years < 2 && (
          <BottomSheetSelect
            label={t("memberAge.months")}
            value={String(age.months)}
            options={options(11)}
            onChange={(months) =>
              onChange(memberAgeToDate({ years: age.years, months: Number(months) }))
            }
          />
        )}
      </View>
    </View>
  );
}
