export function liveKitServerConfig() {
  const url = process.env.LIVEKIT_URL?.trim() ?? "";
  const apiKey = process.env.LIVEKIT_API_KEY?.trim() ?? "";
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim() ?? "";
  return { url, apiKey, apiSecret };
}

export function isLiveKitConfigured(): boolean {
  const { url, apiKey, apiSecret } = liveKitServerConfig();
  return Boolean(url && apiKey && apiSecret);
}