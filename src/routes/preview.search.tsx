import { createFileRoute } from "@tanstack/react-router";
import { Route as SearchRoute, searchServiceFilter } from "./search";
import { CustomerPreview } from "./-customerPreview";

const SearchPage = SearchRoute.options.component!;

export const Route = createFileRoute("/preview/search")({
  validateSearch: searchServiceFilter,
  component: () => (
    <CustomerPreview>
      <SearchPage />
    </CustomerPreview>
  ),
});
