import http from "node:http";
import https from "node:https";
import { collectSplashIdentity } from "./identity.mjs";

function isAllowedHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function urlHost(raw) {
  try {
    return new URL(raw, "http://127.0.0.1").hostname;
  } catch {
    return "";
  }
}

function extractRequestUrl(args) {
  const first = args[0];
  if (typeof first === "string" || first instanceof URL) return String(first);
  if (first && typeof first === "object") {
    if (typeof first.href === "string") return first.href;
    const protocol = first.protocol || "http:";
    const host = first.hostname || first.host || "127.0.0.1";
    const port = first.port ? `:${first.port}` : "";
    const reqPath = first.path || first.pathname || "/";
    return `${protocol}//${host}${port}${reqPath}`;
  }
  return "";
}

function wrapOutgoing(moduleRef, state) {
  const originalRequest = moduleRef.request;
  const originalGet = moduleRef.get;
  moduleRef.request = function splashGuardedRequest(...args) {
    const url = extractRequestUrl(args);
    if (url && !isAllowedHost(urlHost(url))) {
      state.unexpectedServer.push(url);
      const req = originalRequest.apply(this, args);
      req.destroy(new Error(`[splash-host] blocked unexpected server request: ${url}`));
      return req;
    }
    return originalRequest.apply(this, args);
  };
  moduleRef.get = function splashGuardedGet(...args) {
    const url = extractRequestUrl(args);
    if (url && !isAllowedHost(urlHost(url))) {
      state.unexpectedServer.push(url);
      const req = originalGet.apply(this, args);
      req.destroy(new Error(`[splash-host] blocked unexpected server request: ${url}`));
      return req;
    }
    return originalGet.apply(this, args);
  };
}

function installOutboundGuard(state) {
  if (globalThis.__splashOutboundGuard) return;
  globalThis.__splashOutboundGuard = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url && !isAllowedHost(urlHost(url))) {
      state.unexpectedServer.push(url);
      const method = String(init?.method || (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        state.unexpectedWrites.push(`${method} ${url}`);
      }
      throw new Error(`[splash-host] blocked unexpected server fetch: ${url}`);
    }
    return originalFetch(input, init);
  };
  wrapOutgoing(http, state);
  wrapOutgoing(https, state);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function splashMockPlugin(repoRoot) {
  const state = {
    repoRoot,
    unexpectedServer: [],
    unexpectedWrites: [],
  };
  installOutboundGuard(state);

  return {
    name: "splash-mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://127.0.0.1");
          if (!url.pathname.startsWith("/__splash/")) {
            next();
            return;
          }

          if (url.pathname === "/__splash/identity") {
            sendJson(res, 200, collectSplashIdentity(repoRoot));
            return;
          }

          if (url.pathname === "/__splash/network") {
            sendJson(res, 200, {
              unexpected: [...state.unexpectedServer],
              unexpectedWrites: [...state.unexpectedWrites],
            });
            return;
          }

          sendJson(res, 404, { error: "unknown splash harness endpoint" });
        } catch (error) {
          sendJson(res, 500, { error: String(error) });
        }
      });
    },
  };
}
