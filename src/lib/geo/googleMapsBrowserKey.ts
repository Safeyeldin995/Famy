/** Browser Maps JavaScript API key (Vercel / local `.env`). Never log or commit. */
export function getGoogleMapsBrowserKey(): string {
  return import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY?.trim() ?? "";
}
