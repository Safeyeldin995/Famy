import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/famio/AuthGate";
import { AccountDeletionScreen } from "@/components/famio/AccountDeletionScreen";
import { proPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/pro/account/delete")({
  component: ProAccountDeleteRoute,
});

function ProAccountDeleteRoute() {
  return (
    <AuthGate>
      <AccountDeletionScreen backTo={proPath("/pro/profile")} />
    </AuthGate>
  );
}
