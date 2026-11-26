/** Gated provider onboarding roots must not show a back affordance without stack history. */
export function providerHeaderShowsBack(canGoBack: boolean): boolean {
  return canGoBack;
}