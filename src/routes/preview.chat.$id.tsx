import { createFileRoute } from "@tanstack/react-router";
import { ChatContent } from "./messages.$id";
import { CustomerPreview } from "./-customerPreview";

export const Route = createFileRoute("/preview/chat/$id")({
  component: PreviewChatPage,
});

function PreviewChatPage() {
  const { id } = Route.useParams();
  return <CustomerPreview><ChatContent conversationId={id} /></CustomerPreview>;
}
