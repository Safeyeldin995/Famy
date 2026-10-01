import { createFileRoute } from "@tanstack/react-router";
import { BookContent } from "./book.$providerId";

export const Route = createFileRoute("/preview/book/$providerId")({
  validateSearch: (search: Record<string, unknown>) => ({
    serviceId: typeof search.serviceId === "string" ? search.serviceId : undefined,
    capabilityId: typeof search.capabilityId === "string" ? search.capabilityId : undefined,
  }),
  component: PreviewBook,
});

function PreviewBook() {
  const { providerId } = Route.useParams();
  const { serviceId, capabilityId } = Route.useSearch();
  return (
    <BookContent
      providerId={providerId}
      searchServiceId={serviceId}
      searchCapabilityId={capabilityId}
    />
  );
}
