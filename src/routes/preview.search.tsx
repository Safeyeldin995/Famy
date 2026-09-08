import { createFileRoute } from "@tanstack/react-router";
import { Route as SearchRoute } from "./search";

const SearchPage = SearchRoute.options.component!;

export const Route = createFileRoute("/preview/search")({ component: SearchPage });
