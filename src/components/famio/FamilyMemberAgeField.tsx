import { useTranslation } from "react-i18next";
import { BottomSheetSelect } from "./BottomSheetSelect";
import { memberAgeFromDate, memberAgeToDate, memberMaxYears } from "@/lib/familyMemberAge";

export function FamilyMemberAgeField({
  value,
  relationship,
  onChange,
  nested = false,
}: {
  value: string;
  relationship: string;
  onChange: (value: string) => void;
  nested?: boolean;
}) {
  const { t } = useTranslation();
  const age = memberAgeFromDate(value);
  const options = (max: number) =>
    Array.from({ length: max + 1 }, (_, n) => ({ value: String(n), label: String(n) }));
  return (
    <fieldset className="apply-ui">
      <legend className="text-pro-12 font-bold text-muted-foreground">
        {t("memberAge.label")}
      </legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <BottomSheetSelect
          nested={nested}
          label={t("memberAge.years")}
          value={age ? String(age.years) : ""}
          options={options(memberMaxYears(relationship))}
          onChange={(years) =>
            onChange(memberAgeToDate({ years: Number(years), months: age?.months ?? 0 }))
          }
        />
        {age && age.years < 2 && (
          <BottomSheetSelect
            nested={nested}
            label={t("memberAge.months")}
            value={String(age.months)}
            options={options(11)}
            onChange={(months) =>
              onChange(memberAgeToDate({ years: age.years, months: Number(months) }))
            }
          />
        )}
      </div>
    </fieldset>
  );
}
