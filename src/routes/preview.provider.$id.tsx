import { createFileRoute } from "@tanstack/react-router";
import { ProviderProfileContent } from "./provider.$id";

export const Route = createFileRoute("/preview/provider/$id")({
  component: PreviewProviderPage,
});

function PreviewProviderPage() {
  const { id } = Route.useParams();
  return <ProviderProfileContent providerId={id} />;
}
