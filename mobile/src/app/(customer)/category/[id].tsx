import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { Discovery } from "@/ui/Discovery";
export default function Category() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View testID="category-discovery" style={{ flex: 1 }}>
      <Discovery key={id} category={id} />
    </View>
  );
}
