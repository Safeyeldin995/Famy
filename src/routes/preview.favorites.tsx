import { createFileRoute } from "@tanstack/react-router";
import { Route as FavoritesRoute } from "./favorites";

const Favorites = FavoritesRoute.options.component!;

export const Route = createFileRoute("/preview/favorites")({ component: Favorites });
