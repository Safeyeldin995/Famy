import { createFileRoute } from "@tanstack/react-router";
import { ChatContent } from "./messages.$id";

export const Route = createFileRoute("/preview/chat/$id")({
  component: PreviewChatPage,
});

function PreviewChatPage() {
  const { id } = Route.useParams();
  return <ChatContent conversationId={id} />;
}
