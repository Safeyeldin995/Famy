export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_BATCH_SIZE = 100;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  data: { deepLink: string; tag: string };
};

export type ExpoTicket =
  | { status: "ok"; id?: string }
  | { status: "error"; message?: string; details?: { error?: string } };

export type ExpoPushResponse = { data?: ExpoTicket[] };

export function chunkExpoMessages(messages: ExpoPushMessage[]): ExpoPushMessage[][] {
  const batches: ExpoPushMessage[][] = [];
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    batches.push(messages.slice(i, i + EXPO_BATCH_SIZE));
  }
  return batches;
}

export function buildExpoPushMessages(
  tokens: string[],
  title: string,
  body: string,
  deepLink: string,
  tag: string,
): ExpoPushMessage[] {
  return tokens.map((to) => ({
    to,
    title,
    body,
    sound: "default" as const,
    data: { deepLink, tag },
  }));
}

export function expoTicketsNeedingExpiry(tickets: ExpoTicket[], tokens: string[]): string[] {
  const expired: string[] = [];
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const token = tokens[i];
    if (!token || !ticket || ticket.status !== "error") continue;
    if (ticket.details?.error === "DeviceNotRegistered") expired.push(token);
  }
  return expired;
}
