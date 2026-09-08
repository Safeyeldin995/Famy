import { createFileRoute } from "@tanstack/react-router";
import { Route as FamilyRoute } from "./family-members";

const FamilyMembers = FamilyRoute.options.component!;

export const Route = createFileRoute("/preview/family-members")({ component: FamilyMembers });
