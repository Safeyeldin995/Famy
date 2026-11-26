import { rewriteIncomingAppLinkPath } from "@/lib/redirectSystemPath";

export function redirectSystemPath(event: { path: string; initial: boolean }): string {
  try {
    return rewriteIncomingAppLinkPath(event.path);
  } catch {
    return "/";
  }
}