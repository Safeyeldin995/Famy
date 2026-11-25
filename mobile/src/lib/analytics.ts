import analytics from "@react-native-firebase/analytics";

export type FamyAnalyticsEvent =
  | "sign_up"
  | "search"
  | "view_provider"
  | "start_booking"
  | "booking_created"
  | "payment_success"
  | "online_request"
  | "online_join";

type AnalyticsParams = Record<string, string | number | boolean>;

export async function logFamyEvent(
  name: FamyAnalyticsEvent,
  params?: AnalyticsParams,
): Promise<void> {
  try {
    await (analytics as () => { logEvent: (n: string, p?: AnalyticsParams) => Promise<void> })().logEvent(
      name,
      params,
    );
  } catch {
    // Analytics must never block user flows when native Firebase is unavailable.
  }
}