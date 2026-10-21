import { createFileRoute } from "@tanstack/react-router";
import { AccountDeletionScreen } from "@/components/famio/AccountDeletionScreen";
import { proPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/preview/pro/account/delete")({
  component: PreviewProAccountDeleteRoute,
});

function PreviewProAccountDeleteRoute() {
  return <AccountDeletionScreen backTo={proPath("/pro/profile")} />;
}
