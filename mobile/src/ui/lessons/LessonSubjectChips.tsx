import { Pressable, View } from "react-native";
import { isLessonServiceSlug } from "@shared/tutoring/lessonServices";
import { LessonIllustration } from "@/ui/lessons/LessonIllustration";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

type SubjectRow = { id: string; code: string; name_ar: string; name_en: string };

export function LessonSubjectChips({
  serviceSlug,
  subjects,
  value,
  onChange,
  label,
}: {
  serviceSlug?: string | null;
  subjects: SubjectRow[];
  value: string;
  onChange: (id: string) => void;
  label: (row: SubjectRow) => string;
}) {
  if (!isLessonServiceSlug(serviceSlug) || subjects.length === 0) return null;

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {subjects.map((row) => {
        const selected = value === row.id;
        const name = label(row);
        return (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={name}
            onPress={() => onChange(row.id)}
            style={{
              width: 108,
              padding: space.sm,
              borderRadius: radius.lg,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? colors.brand : colors.border,
              backgroundColor: selected ? colors.brandTint : colors.surface,
              alignItems: "center",
              gap: space.xs,
            }}
          >
            <LessonIllustration
              subjectCode={row.code}
              accessibilityLabel={name}
              width={40}
              height={40}
            />
            <Text size="xs" weight="bold" style={{ textAlign: "center" }}>
              {name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
