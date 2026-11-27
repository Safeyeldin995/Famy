import { normalizeWebPathname } from "./webSurface";

/** Product Owner v1: all online-lesson web UX lives under this prefix. */
export const ONLINE_WEB_PREFIX = "/online";

export const ONLINE_WEB_WALLET_TERMS_AR =
  "رصيدك متاح تستخدمه في أي حجز جاي على فامي";

/** Planned v1 routes (#398, aligned with PO decisions on #397). */
export const ONLINE_WEB_ROUTE_IDS = {
  home: `${ONLINE_WEB_PREFIX}`,
  login: `${ONLINE_WEB_PREFIX}/login`,
  signup: `${ONLINE_WEB_PREFIX}/signup`,
  completeProfile: `${ONLINE_WEB_PREFIX}/complete-profile`,
  forgotPassword: `${ONLINE_WEB_PREFIX}/forgot-password`,
  resetPassword: `${ONLINE_WEB_PREFIX}/reset-password`,
  otp: `${ONLINE_WEB_PREFIX}/otp`,
  setPassword: `${ONLINE_WEB_PREFIX}/set-password`,
  authCallback: `${ONLINE_WEB_PREFIX}/auth/callback`,
  wallet: `${ONLINE_WEB_PREFIX}/wallet`,
  tutors: `${ONLINE_WEB_PREFIX}/tutors`,
  students: `${ONLINE_WEB_PREFIX}/students`,
  lessons: `${ONLINE_WEB_PREFIX}/lessons`,
  providerRequests: `${ONLINE_WEB_PREFIX}/provider/requests`,
  providerLessons: `${ONLINE_WEB_PREFIX}/provider/lessons`,
} as const;

export function onlineWebLessonPath(bookingId: string): string {
  return `${ONLINE_WEB_ROUTE_IDS.lessons}/${bookingId}`;
}

export function onlineWebLessonRoomPath(bookingId: string): string {
  return `${onlineWebLessonPath(bookingId)}/room`;
}

export function onlineWebTutorRequestPath(providerId: string): string {
  return `${ONLINE_WEB_ROUTE_IDS.tutors}/${providerId}/request`;
}

export function isOnlineWebSurfacePath(pathname: string): boolean {
  const path = normalizeWebPathname(pathname);
  return path === ONLINE_WEB_PREFIX || path.startsWith(`${ONLINE_WEB_PREFIX}/`);
}