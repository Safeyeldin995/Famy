import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react-native";
import { CustomerEmpty } from "./customer/Primitives";

/** Matches the web EmptyState rather than the native generic query placeholder. */
export function CustomerEmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <CustomerEmpty Icon={Icon} title={title} body={body}>
      {action}
    </CustomerEmpty>
  );
}
