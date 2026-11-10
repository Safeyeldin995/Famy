import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react-native";
import { CustomerEmpty } from "./customer/Primitives";

/** Provider lists use the same empty pattern as customer screens. */
export function ProviderEmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <CustomerEmpty Icon={icon} title={title} body={body}>
      {children}
    </CustomerEmpty>
  );
}
