import DeleteAccountScreen from "../(customer)/delete-account";
import { useMyProvider } from "@/lib/provider/queries";
import { providerSelfServiceBackTarget } from "@/lib/provider/providerAccountBack";

export default function ProDeleteAccountScreen() {
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const status = provider?.onboarding_status as string | undefined;
  const backTo = providerSelfServiceBackTarget(!!provider, status);
  return <DeleteAccountScreen backTo={backTo} />;
}
