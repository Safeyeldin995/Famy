import { createFileRoute, Navigate } from "@tanstack/react-router";

/** Legacy document upload route — PATCH 5 onboarding wizard owns secure uploads. */
export const Route = createFileRoute("/pro/documents")({
  component: () => <Navigate to="/pro/onboarding" replace />,
});
