import { useLocalSearchParams } from "expo-router";
import { Discovery } from "@/ui/Discovery";
export default function Category() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Discovery key={id} category={id} />;
}
