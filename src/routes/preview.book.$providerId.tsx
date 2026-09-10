import { createFileRoute } from "@tanstack/react-router";
import { BookContent } from "./book.$providerId";

export const Route = createFileRoute("/preview/book/$providerId")({
  validateSearch: (search: Record<string, unknown>) => ({
    serviceId: typeof search.serviceId === "string" ? search.serviceId : undefined,
  }),
  component: PreviewBook,
});

function PreviewBook() {
  const { providerId } = Route.useParams();
  const { serviceId } = Route.useSearch();
  return <BookContent providerId={providerId} searchServiceId={serviceId} />;
}
