import { createFileRoute } from "@tanstack/react-router";
import { Route as ProfileRoute } from "./profile";

const Profile = ProfileRoute.options.component!;

export const Route = createFileRoute("/preview/profile")({ component: Profile });
