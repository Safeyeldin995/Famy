import { CustomerPreview } from "./-customerPreview";
import { createFileRoute } from "@tanstack/react-router";
import { EditAddress } from "./addresses.$id";

export const Route = createFileRoute("/preview/addresses/$id")({
  component: PreviewEditAddress,
});

function PreviewEditAddress() {
  const { id } = Route.useParams();
  return (
    <CustomerPreview>
      <EditAddress id={id} />
    </CustomerPreview>
  );
}
