import { createFileRoute } from "@tanstack/react-router";
import { AccountDeletionScreen } from "@/components/famio/AccountDeletionScreen";
import { previewPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/preview/account/delete")({
  component: PreviewAccountDeleteRoute,
});

function PreviewAccountDeleteRoute() {
  return <AccountDeletionScreen backTo={previewPath("/profile")} />;
}
