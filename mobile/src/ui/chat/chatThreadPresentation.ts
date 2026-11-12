import { chatPhaseForStatus, type ChatPhase } from "@/lib/chatPure";

export function chatComposerVisible(phase: ChatPhase): boolean {
  return phase === "writable";
}

export function chatPhaseForBookingStatus(status: string | undefined): ChatPhase {
  return chatPhaseForStatus(status);
}

export function isChatClosedError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: string }).message ?? "")
        : "";
  return msg === "chat_closed" || msg.includes("chat_closed");
}
