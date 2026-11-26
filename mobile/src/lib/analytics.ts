import { getApp } from "@react-native-firebase/app";
import { getAnalytics, logEvent } from "@react-native-firebase/analytics";

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
    const analytics = getAnalytics(getApp());
    await logEvent(
      analytics,
      name as Parameters<typeof logEvent>[1],
      params as Parameters<typeof logEvent>[2],
    );
  } catch {
    // Analytics must never block user flows when native Firebase is unavailable.
  }
}