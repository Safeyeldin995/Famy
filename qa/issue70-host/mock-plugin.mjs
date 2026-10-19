import http from "node:http";
import https from "node:https";
import { collectIssue70Identity } from "./identity.mjs";
import { EXISTING_ADDRESS_ID, EXISTING_COORDS, MOCK_USER_ID, TILE_PNG } from "./constants.mjs";

const ALLOWED_WRITE_TABLES = new Set(["profiles", "addresses"]);

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
  moduleRef.request = function issue70GuardedRequest(...args) {
    const url = extractRequestUrl(args);
    if (url && !isAllowedHost(urlHost(url))) {
      state.unexpectedServer.push(url);
      const req = originalRequest.apply(this, args);
      req.destroy(new Error(`[issue70-host] blocked unexpected server request: ${url}`));
      return req;
    }
    return originalRequest.apply(this, args);
  };
  moduleRef.get = function issue70GuardedGet(...args) {
    const url = extractRequestUrl(args);
    if (url && !isAllowedHost(urlHost(url))) {
      state.unexpectedServer.push(url);
      const req = originalGet.apply(this, args);
      req.destroy(new Error(`[issue70-host] blocked unexpected server request: ${url}`));
      return req;
    }
    return originalGet.apply(this, args);
  };
}

function installOutboundGuard(state) {
  if (globalThis.__issue70OutboundGuard) return;
  globalThis.__issue70OutboundGuard = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url && !isAllowedHost(urlHost(url))) {
      state.unexpectedServer.push(url);
      throw new Error(`[issue70-host] blocked unexpected server fetch: ${url}`);
    }
    return originalFetch(input, init);
  };
  wrapOutgoing(http, state);
  wrapOutgoing(https, state);
}

function buildProfile(state) {
  return {
    id: MOCK_USER_ID,
    full_name: state.profileName,
    phone: "+201001112233",
    avatar_url: null,
    created_at: "2026-09-01T00:00:00+00:00",
    updated_at: "2026-09-01T00:00:00+00:00",
  };
}

function buildExistingAddress() {
  return {
    id: EXISTING_ADDRESS_ID,
    user_id: MOCK_USER_ID,
    label: "home",
    custom_label: null,
    city: "Giza",
    area: "Sheikh Zayed",
    street: "Villa 8, Allegria Gate 4",
    line1: "Villa 8, Allegria Gate 4",
    line2: "Allegria · Villa 8 · 1 · Call on arrival",
    compound: "Allegria",
    building: "Villa 8",
    apartment: "1",
    floor: null,
    landmark: null,
    access_notes: "Call on arrival",
    lat: EXISTING_COORDS.lat,
    lng: EXISTING_COORDS.lng,
    is_default: true,
    created_at: "2026-09-01T00:00:00+00:00",
    updated_at: "2026-09-01T00:00:00+00:00",
  };
}

function createState(repoRoot) {
  return {
    repoRoot,
    scenario: "new-address",
    addressDelayMs: 0,
    saveDelayMs: 0,
    saveShouldFail: false,
    unexpectedServer: [],
    unexpectedWrites: [],
    writes: [],
    log: [],
    profileName: "Nour Hassan",
    addresses: [],
    createdCount: 0,
    updatedCount: 0,
    profileUpdate: 0,
    addressReads: 0,
    profileReads: 0,
    settingsReads: 0,
  };
}

function resetState(state, body = {}) {
  const scenario =
    body.scenario === "existing-address" ||
    body.scenario === "existing-address-delayed" ||
    body.scenario === "signed-out" ||
    body.scenario === "save-fail" ||
    body.scenario === "new-address"
      ? body.scenario
      : "new-address";
  state.scenario = scenario;
  state.addressDelayMs = Number(body.addressDelayMs) || 0;
  state.saveDelayMs = Number(body.saveDelayMs) || 0;
  state.saveShouldFail = Boolean(body.saveShouldFail) || scenario === "save-fail";
  state.unexpectedServer = [];
  state.unexpectedWrites = [];
  state.writes = [];
  state.log = [];
  state.profileName = "Nour Hassan";
  state.createdCount = 0;
  state.updatedCount = 0;
  state.profileUpdate = 0;
  state.addressReads = 0;
  state.profileReads = 0;
  state.settingsReads = 0;
  if (scenario === "existing-address" || scenario === "existing-address-delayed") {
    state.addresses = [buildExistingAddress()];
    if (scenario === "existing-address-delayed" && !state.addressDelayMs) {
      state.addressDelayMs = 1500;
    }
  } else {
    state.addresses = [];
  }
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    ...extraHeaders,
  });
  res.end(payload);
}

function sendEmpty(res, status) {
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function wantsObject(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("application/vnd.pgrst.object+json");
}

function parseEq(url, key) {
  const value = url.searchParams.get(key);
  if (!value) return null;
  return value.startsWith("eq.") ? value.slice(3) : value;
}

function tableName(pathname) {
  return pathname.slice("/rest/v1/".length).split("/")[0];
}

function authUser() {
  return {
    id: MOCK_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "issue70@famio.local",
    phone: "201001112233",
  };
}

function authSession() {
  const user = authUser();
  return {
    access_token: "issue70-mock-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "issue70-mock-refresh",
    user,
    ...user,
  };
}

function recordWrite(state, method, table, body, extra = {}) {
  const write = { method, table, body, at: Date.now(), ...extra };
  state.writes.push(write);
  state.log.push(`${method} ${table}`);
  return write;
}

async function handleSupabase(state, req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const method = req.method || "GET";
  const p = url.pathname;

  if (method === "OPTIONS") {
    sendEmpty(res, 204);
    return;
  }

  if (state.scenario === "signed-out") {
    if (p.startsWith("/auth/v1/") || p.startsWith("/rest/v1/") || p.startsWith("/storage/v1/")) {
      sendJson(res, 401, { message: "Auth session missing!", hint: "issue70 signed-out" });
      return;
    }
  }

  if (p === "/auth/v1/user" || p.startsWith("/auth/v1/token") || p === "/auth/v1/session") {
    sendJson(res, 200, authSession());
    return;
  }

  if (p.startsWith("/rest/v1/profiles")) {
    if (method === "GET") {
      state.profileReads += 1;
      state.log.push(`profileRead#${state.profileReads}`);
      const row = buildProfile(state);
      if (wantsObject(req)) {
        sendJson(res, 200, row, {
          "content-type": "application/vnd.pgrst.object+json; charset=utf-8",
        });
      } else {
        sendJson(res, 200, [row]);
      }
      return;
    }
    if (method === "PATCH" || method === "POST") {
      const raw = await readBody(req);
      let body = {};
      try {
        body = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        body = { raw: raw.toString("utf8") };
      }
      recordWrite(state, method, "profiles", body);
      state.profileUpdate += 1;
      if (typeof body.full_name === "string") state.profileName = body.full_name;
      const row = buildProfile(state);
      if (wantsObject(req)) {
        sendJson(res, 200, row, {
          "content-type": "application/vnd.pgrst.object+json; charset=utf-8",
        });
      } else {
        sendJson(res, 200, [row]);
      }
      return;
    }
  }

  if (p.startsWith("/rest/v1/addresses")) {
    if (method === "GET") {
      if (state.addressDelayMs) await new Promise((r) => setTimeout(r, state.addressDelayMs));
      state.addressReads += 1;
      state.log.push(`addressRead#${state.addressReads}`);
      if (wantsObject(req)) {
        const id = parseEq(url, "id");
        const row = state.addresses.find((item) => item.id === id) ?? null;
        if (!row) {
          sendJson(
            res,
            406,
            {
              code: "PGRST116",
              details: "The result contains 0 rows",
              hint: null,
              message: "JSON object requested, multiple (or no) rows returned",
            },
            { "content-type": "application/vnd.pgrst.object+json; charset=utf-8" },
          );
          return;
        }
        sendJson(res, 200, row, {
          "content-type": "application/vnd.pgrst.object+json; charset=utf-8",
        });
        return;
      }
      sendJson(res, 200, state.addresses);
      return;
    }

    if (method === "POST" || method === "PATCH") {
      if (state.saveDelayMs) await new Promise((r) => setTimeout(r, state.saveDelayMs));
      const raw = await readBody(req);
      let body = {};
      try {
        body = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        body = { raw: raw.toString("utf8") };
      }
      const id = parseEq(url, "id");
      recordWrite(state, method, "addresses", body, { id });
      if (state.saveShouldFail) {
        sendJson(res, 500, { code: "PGRST000", message: "Could not save address" });
        return;
      }
      if (method === "POST") {
        state.createdCount += 1;
        const row = {
          id: `created-${state.createdCount}`,
          user_id: MOCK_USER_ID,
          is_default: Boolean(body.is_default),
          created_at: "2026-09-27T00:00:00+00:00",
          updated_at: "2026-09-27T00:00:00+00:00",
          ...body,
        };
        state.addresses.push(row);
        if (wantsObject(req)) {
          sendJson(res, 200, row, {
            "content-type": "application/vnd.pgrst.object+json; charset=utf-8",
          });
        } else {
          sendJson(res, 201, [row]);
        }
        return;
      }
      state.updatedCount += 1;
      const index = state.addresses.findIndex((item) => item.id === id);
      const current = index >= 0 ? state.addresses[index] : buildExistingAddress();
      const row = { ...current, ...body, id: id ?? current.id, user_id: MOCK_USER_ID };
      if (index >= 0) state.addresses[index] = row;
      else state.addresses.push(row);
      if (wantsObject(req)) {
        sendJson(res, 200, row, {
          "content-type": "application/vnd.pgrst.object+json; charset=utf-8",
        });
      } else {
        sendJson(res, 200, [row]);
      }
      return;
    }

    if (method === "DELETE") {
      const raw = await readBody(req);
      recordWrite(state, method, "addresses", raw.toString("utf8"), { id: parseEq(url, "id") });
      state.unexpectedWrites.push({
        method,
        table: "addresses",
        reason: "delete-not-part-of-setup-save",
      });
      sendJson(res, 403, { message: "[issue70-host] blocked unexpected address delete" });
      return;
    }
  }

  if (p.startsWith("/rest/v1/settings")) {
    state.settingsReads += 1;
    const row = {
      key: "service_areas",
      value: {
        areas: [
          { name: "Sheikh Zayed", enabled: true },
          { name: "6th of October", enabled: true },
        ],
      },
    };
    if (wantsObject(req)) {
      sendJson(res, 200, row, {
        "content-type": "application/vnd.pgrst.object+json; charset=utf-8",
      });
    } else {
      sendJson(res, 200, [row]);
    }
    return;
  }

  if (p.startsWith("/rest/v1/user_roles")) {
    sendJson(res, 200, [{ role: "customer" }]);
    return;
  }

  if (p.startsWith("/storage/v1/object/sign/")) {
    sendJson(res, 200, { signedURL: "/__issue70/avatar.jpg" });
    return;
  }

  if (
    p.startsWith("/rest/v1/") &&
    (method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE")
  ) {
    const table = tableName(p);
    const raw = await readBody(req);
    let body = {};
    try {
      body = JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      body = { raw: raw.toString("utf8") };
    }
    if (!ALLOWED_WRITE_TABLES.has(table)) {
      state.unexpectedWrites.push({ method, table, body });
      sendJson(res, 403, { message: `[issue70-host] blocked unexpected write to ${table}` });
      return;
    }
    recordWrite(state, method, table, body);
    sendJson(res, 200, {});
    return;
  }

  if (p.startsWith("/rest/v1/") || p.startsWith("/auth/v1/") || p.startsWith("/storage/v1/")) {
    sendJson(res, 200, method === "GET" ? [] : {});
    return;
  }
}

function isHarnessOrMock(pathname) {
  return (
    pathname.startsWith("/__issue70/") ||
    pathname.startsWith("/auth/v1/") ||
    pathname.startsWith("/rest/v1/") ||
    pathname.startsWith("/storage/v1/")
  );
}

export function issue70MockPlugin(repoRoot) {
  const state = createState(repoRoot);
  installOutboundGuard(state);
  resetState(state);

  return {
    name: "issue70-mock-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://127.0.0.1");
          if (!isHarnessOrMock(url.pathname)) {
            next();
            return;
          }

          if (url.pathname === "/__issue70/identity") {
            sendJson(res, 200, collectIssue70Identity(repoRoot));
            return;
          }

          if (url.pathname === "/__issue70/config" && req.method === "POST") {
            const raw = await readBody(req);
            const body = JSON.parse(raw.toString("utf8") || "{}");
            resetState(state, body);
            sendJson(res, 200, { ok: true, scenario: state.scenario });
            return;
          }

          if (url.pathname === "/__issue70/calls") {
            sendJson(res, 200, {
              scenario: state.scenario,
              profileReads: state.profileReads,
              addressReads: state.addressReads,
              settingsReads: state.settingsReads,
              profileUpdate: state.profileUpdate,
              createdCount: state.createdCount,
              updatedCount: state.updatedCount,
              writes: state.writes,
              unexpectedWrites: state.unexpectedWrites,
              log: state.log,
              addressIds: state.addresses.map((row) => row.id),
            });
            return;
          }

          if (url.pathname === "/__issue70/network") {
            sendJson(res, 200, {
              unexpected: [...state.unexpectedServer],
              unexpectedWrites: [...state.unexpectedWrites],
            });
            return;
          }

          if (
            url.pathname.startsWith("/__issue70/tiles/") ||
            url.pathname === "/__issue70/tile.png"
          ) {
            res.writeHead(200, { "content-type": "image/png" });
            res.end(TILE_PNG);
            return;
          }

          if (url.pathname === "/__issue70/avatar.jpg") {
            res.writeHead(200, { "content-type": "image/jpeg" });
            res.end(TILE_PNG);
            return;
          }

          await handleSupabase(state, req, res);
        } catch (error) {
          sendJson(res, 500, { error: String(error) });
        }
      });
    },
  };
}
