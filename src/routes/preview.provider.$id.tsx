import { createFileRoute } from "@tanstack/react-router";
import { CustomerPreview } from "./-customerPreview";
import { ProviderProfileContent } from "./provider.$id";

export const Route = createFileRoute("/preview/provider/$id")({
  component: PreviewProviderPage,
});

function PreviewProviderPage() {
  const { id } = Route.useParams();
  return <CustomerPreview><ProviderProfileContent providerId={id} /></CustomerPreview>;
}
