import { createFileRoute, Navigate } from "@tanstack/react-router";
import { proPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/preview/pro/documents")({
  component: () => <Navigate to={proPath("/pro/onboarding") as "/pro/onboarding"} replace />,
});
