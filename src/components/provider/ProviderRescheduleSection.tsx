import type { ComponentProps } from "react";
import { RescheduleSection } from "@/components/famio/RescheduleSection";
import { useRescheduleRequests } from "@/lib/db/queries";

/** Providers only need this block when a request requires a response. */
export function ProviderRescheduleSection(
  props: Omit<ComponentProps<typeof RescheduleSection>, "viewer" | "compact">,
) {
  const requests = useRescheduleRequests(props.bookingId);
  if (!requests.data?.some((request) => request.status === "pending")) return null;
  return <RescheduleSection {...props} viewer="provider" compact />;
}
