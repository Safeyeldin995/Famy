import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/famio/AuthGate";
import { AccountDeletionScreen } from "@/components/famio/AccountDeletionScreen";
import { previewPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/account/delete")({
  component: AccountDeleteRoute,
});

function AccountDeleteRoute() {
  return (
    <AuthGate>
      <AccountDeletionScreen backTo={previewPath("/profile")} />
    </AuthGate>
  );
}
