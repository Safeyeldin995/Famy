import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/famio/AuthGate";
import { AccountDeletionScreen } from "@/components/famio/AccountDeletionScreen";
import { ACCOUNT_DELETE_INTENT } from "@/lib/web/webSurface";

export const Route = createFileRoute("/account/delete")({
  component: AccountDeleteRoute,
});

function AccountDeleteRoute() {
  return (
    <AuthGate loginIntent={ACCOUNT_DELETE_INTENT}>
      <AccountDeletionScreen backTo="/" />
    </AuthGate>
  );
}
