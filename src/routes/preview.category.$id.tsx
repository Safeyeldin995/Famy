import { CustomerPreview } from "./-customerPreview";
import { createFileRoute } from "@tanstack/react-router";
import { CategoryPageContent } from "./category.$id";

export const Route = createFileRoute("/preview/category/$id")({
  component: PreviewCategoryPage,
});

function PreviewCategoryPage() {
  const { id } = Route.useParams();
  return (
    <CustomerPreview>
      <CategoryPageContent categoryId={id} />
    </CustomerPreview>
  );
}
