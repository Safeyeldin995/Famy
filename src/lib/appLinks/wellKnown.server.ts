const ANDROID_PACKAGE = "com.famy.app";
const IOS_BUNDLE = "com.famy.app";
const WEB_HOST = "famy-chi.vercel.app";

export function assetLinksDocument(env: NodeJS.ProcessEnv = process.env): string {
  const sha256 = env.ANDROID_APP_LINK_SHA256?.trim();
  if (!sha256) {
    return JSON.stringify([]);
  }
  return JSON.stringify([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: [sha256],
      },
    },
  ]);
}

export function appleAppSiteAssociation(env: NodeJS.ProcessEnv = process.env): string {
  const teamId = env.APPLE_APP_LINK_TEAM_ID?.trim();
  const details =
    teamId && teamId.length > 0
      ? [
          {
            appID: `${teamId}.${IOS_BUNDLE}`,
            paths: ["/booking/*", "/online/lessons/*", "/p/*", "/provider/*"],
          },
        ]
      : [];
  return JSON.stringify({
    applinks: {
      apps: [],
      details,
    },
  });
}

export function wellKnownResponse(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=300",
    },
  });
}

export const appLinkWebHost = WEB_HOST;