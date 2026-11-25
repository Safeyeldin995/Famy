type AppleSignInEnv = {
  EXPO_PUBLIC_APPLE_SIGNIN_READY?: string;
  appleSignInReady?: boolean | string;
};

export function mobileAppleSignInConfiguredFromEnv(env: AppleSignInEnv): boolean {
  const fromExtra = env.appleSignInReady;
  if (fromExtra === true || fromExtra === "1") return true;
  return env.EXPO_PUBLIC_APPLE_SIGNIN_READY === "1";
}
/**
 * Apple guideline 4.8: on iOS, a third-party login (Google) may only be offered
 * when Sign in with Apple is offered too.
 */
export function showGoogleSignInOnMobile(opts: {
  platform: string;
  googleEnabled: boolean;
  appleShownOnIos: boolean;
}): boolean {
  if (!opts.googleEnabled) return false;
  return opts.platform !== "ios" || opts.appleShownOnIos;
}
