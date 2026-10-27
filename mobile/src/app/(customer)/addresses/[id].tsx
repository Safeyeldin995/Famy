import { useLocalSearchParams } from "expo-router";
import { AddressEditor } from "@/ui/customer/AddressEditor";
export default function EditAddress() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AddressEditor addressId={id} />;
}
