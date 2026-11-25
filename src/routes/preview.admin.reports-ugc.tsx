import { createFileRoute } from "@tanstack/react-router";
import { AdminReportsUgc } from "./admin.reports-ugc";

export const Route = createFileRoute("/preview/admin/reports-ugc")({
  component: AdminReportsUgc,
});