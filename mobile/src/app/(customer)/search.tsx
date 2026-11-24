import { View } from "react-native";
import { Discovery } from "@/ui/Discovery";

export default function Search() {
  return (
    <View testID="search-discovery" style={{ flex: 1 }}>
      <Discovery />
    </View>
  );
}
