type AppleSignInEnv = {
  EXPO_PUBLIC_APPLE_SIGNIN_READY?: string;
  appleSignInReady?: boolean | string;
};

export function mobileAppleSignInConfiguredFromEnv(env: AppleSignInEnv): boolean {
  const fromExtra = env.appleSignInReady;
  if (fromExtra === true || fromExtra === "1") return true;
  return env.EXPO_PUBLIC_APPLE_SIGNIN_READY === "1";
}