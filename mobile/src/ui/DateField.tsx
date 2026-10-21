import { useState } from "react";
import { View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Text } from "./Text";
export type DateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maximumDate?: Date;
};
export function DateField({ label, value, onChange, maximumDate }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const { i18n } = useTranslation();
  return (
    <View>
      <Text weight="bold">{label}</Text>
      <Button variant="secondary" label={value || label} onPress={() => setOpen(true)} />
      {open && (
        <DateTimePicker
          value={value ? new Date(value + "T12:00:00") : new Date()}
          maximumDate={maximumDate}
          mode="date"
          locale={i18n.language}
          onChange={(event, date) => {
            setOpen(false);
            if (event.type === "set" && date)
              onChange(
                `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
              );
          }}
        />
      )}
    </View>
  );
}
