import { createFileRoute } from "@tanstack/react-router";
import { Route as SearchRoute, searchServiceFilter } from "./search";

const SearchPage = SearchRoute.options.component!;

export const Route = createFileRoute("/preview/search")({ validateSearch: searchServiceFilter, component: SearchPage });
