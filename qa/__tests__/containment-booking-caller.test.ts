import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  authenticateBookingCaller,
  BOOKING_CALLER_CLASS,
  CALLER_AUTH_MODE,
  extractHashedTokenFromGenerateLink,
  revokeBookingCallerSession,
  selectBookingCaller,
} from "../containment-booking-caller.mjs";
import { assertContainmentPlanApproved, executeContainmentPlan } from "../containment-core.mjs";
import {
  fingerprintContainmentPlan,
  INVALIDATED_CONTAINMENT_FINGERPRINT_V1,
  INVALIDATED_CONTAINMENT_FINGERPRINT_V2,
} from "../containment-fingerprint.mjs";
import { buildContainmentPlanFromSnapshot, sanitizeContainmentPlanForReport } from "../containment-planner.mjs";
import { KNOWN_QA_PROJECT_REF } from "../qa-identity.mjs";

const CALLER_ID = "f08b1111-1111-4111-8111-1111111174ff";
const OTHER_ADMIN_ID = "aaaa1111-1111-4111-8111-111111111111";
const REASON_ID = "cccc1111-1111-4111-8111-111111111111";

function eligibleAdmin(userId = CALLER_ID) {
  return {
    userId,
    email: "qa-admin@famio.local",
    fullName: "QA_admin",
    authBanned: false,
    profileSuspended: false,
    hasAdminRole: true,
    inRegistry: true,
  };
}

function buildPlanWithBookings(overrides = {}) {
  return buildContainmentPlanFromSnapshot({
    projectRef: KNOWN_QA_PROJECT_REF,
    cancellationReasonId: REASON_ID,
    identities: [eligibleAdmin()],
    bookings: [{
      id: "4a221111-1111-4111-8111-111111116208",
      status: "pending",
      notes: "QA booking",
      hasCancellationRecord: false,
    }],
    ...overrides,
  });
}

function containmentModuleUrl() {
  return pathToFileURL(path.join(process.cwd(), "qa/containment.mjs")).href;
}

function buildMagicLinkAuthDeps(options: {
  verifyUserId?: string;
  rpcImpl?: (...args: unknown[]) => Promise<{ error: unknown }>;
  generateError?: boolean;
  missingHashedToken?: boolean;
  verifyError?: boolean;
} = {}) {
  const verifyUserId = options.verifyUserId ?? CALLER_ID;
  const rpc = vi.fn(options.rpcImpl ?? (async () => ({ error: null })));
  return {
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "publishable-key",
    generateLink: vi.fn(async () => ({
      data: options.missingHashedToken
        ? {}
        : { properties: { hashed_token: "hashed-token" } },
      error: options.generateError ? { message: "generate failed" } : null,
    })),
    verifyOtp: vi.fn(async () => ({
      data: options.verifyError
        ? null
        : {
            user: { id: verifyUserId },
            session: { access_token: "jwt-token" },
          },
      error: options.verifyError ? { message: "verify failed" } : null,
    })),
    createPublishableClient: () => ({
      auth: { verifyOtp: vi.fn() },
      rpc,
    }),
  };
}

describe("booking caller selection", () => {
  it("selects exactly one eligible admin caller", () => {
    const result = selectBookingCaller([eligibleAdmin()], true);
    expect(result.ok).toBe(true);
    expect(result.caller?.userId).toBe(CALLER_ID);
    expect(result.caller?.callerClass).toBe(BOOKING_CALLER_CLASS);
  });

  it("blocks planning when zero callers exist", () => {
    const result = selectBookingCaller([{
      ...eligibleAdmin(),
      hasAdminRole: false,
    }], true);
    expect(result.ok).toBe(false);
    expect(result.blocked?.reason).toBe("zero-booking-callers");
  });

  it("blocks planning when multiple callers exist", () => {
    const result = selectBookingCaller([
      eligibleAdmin(CALLER_ID),
      eligibleAdmin(OTHER_ADMIN_ID),
    ], true);
    expect(result.ok).toBe(false);
    expect(result.blocked?.reason).toBe("multiple-booking-callers");
  });

  it("rejects already-banned admin caller", () => {
    const result = selectBookingCaller([{
      ...eligibleAdmin(),
      authBanned: true,
    }], true);
    expect(result.ok).toBe(false);
  });

  it("rejects suspended admin caller", () => {
    const result = selectBookingCaller([{
      ...eligibleAdmin(),
      profileSuspended: true,
    }], true);
    expect(result.ok).toBe(false);
  });
});

function mockAdminTables(overrides: {
  roles?: Array<{ role: string }>;
  profileSuspended?: boolean;
  bookingStatus?: string;
  onBan?: () => void;
  onSuspend?: () => void;
  onRemoveAdmin?: () => void;
} = {}) {
  return vi.fn((table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn((_column: string, value: string) => {
        if (table === "user_roles") {
          return {
            eq: vi.fn(async () => ({
              data: overrides.roles ?? [{ role: "admin" }],
              error: null,
            })),
          };
        }
        if (table === "profiles") {
          return {
            maybeSingle: vi.fn(async () => ({
              data: { full_name: "QA_admin", is_suspended: overrides.profileSuspended ?? false },
              error: null,
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => {
                overrides.onSuspend?.();
                return { error: null };
              }),
            })),
          };
        }
        if (table === "bookings") {
          return {
            maybeSingle: vi.fn(async () => ({
              data: { status: overrides.bookingStatus ?? "cancelled" },
              error: null,
            })),
          };
        }
        if (table === "booking_cancellations") {
          return {
            maybeSingle: vi.fn(async () => ({ data: { booking_id: value }, error: null })),
          };
        }
        return Promise.resolve({ data: null, error: null });
      }),
      delete: vi.fn(() => ({
        eq: vi.fn(async () => {
          overrides.onRemoveAdmin?.();
          return { error: null };
        }),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    })),
  }));
}

describe("booking caller authentication", () => {
  it("causes zero mutations when login user ID mismatches", async () => {
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: CALLER_ID, email: "qa-admin@famio.local", banned_until: null } },
            error: null,
          })),
          signOut: vi.fn(async () => ({ error: null })),
        },
      },
      from: mockAdminTables(),
      rpc: vi.fn(),
    };

    const plan = buildPlanWithBookings();
    const execution = await executeContainmentPlan(admin as never, plan, {
      authDeps: buildMagicLinkAuthDeps({ verifyUserId: "wrong-user-id" }),
    });

    expect(execution.aborted).toBe(true);
    expect(execution.mutationsStarted).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalledWith("services");
  });

  it("causes zero mutations when magiclink generation fails", async () => {
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: CALLER_ID, email: "qa-admin@famio.local" } },
            error: null,
          })),
        },
      },
      from: vi.fn(),
      rpc: vi.fn(),
    };

    const auth = await authenticateBookingCaller(admin as never, CALLER_ID, buildMagicLinkAuthDeps({ generateError: true }));

    expect(auth.ok).toBe(false);
    expect(auth.mutationsAllowed).toBe(false);
    expect(auth.reason).toBe("caller-magiclink-generation-failed");
  });

  it("causes zero mutations when magiclink verification fails", async () => {
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: CALLER_ID, email: "qa-admin@famio.local" } },
            error: null,
          })),
        },
      },
      from: vi.fn(),
      rpc: vi.fn(),
    };

    const auth = await authenticateBookingCaller(admin as never, CALLER_ID, buildMagicLinkAuthDeps({ verifyError: true }));

    expect(auth.ok).toBe(false);
    expect(auth.mutationsAllowed).toBe(false);
    expect(auth.reason).toBe("caller-magiclink-verification-failed");
  });

  it("causes zero mutations when admin role is missing", async () => {
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: CALLER_ID, email: "qa-admin@famio.local", banned_until: null } },
            error: null,
          })),
        },
      },
      from: mockAdminTables({ roles: [] }),
    };

    const auth = await authenticateBookingCaller(admin as never, CALLER_ID, buildMagicLinkAuthDeps());

    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe("caller-missing-admin-role");
  });
});

describe("booking caller execution order", () => {
  it("never falls back to service role for cancel_booking", async () => {
    const rpcCalls: Array<{ client: string; args: unknown[] }> = [];
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: CALLER_ID, email: "qa-admin@famio.local", banned_until: null } },
            error: null,
          })),
          signOut: vi.fn(async () => ({ error: null })),
        },
      },
      from: mockAdminTables(),
      rpc: vi.fn(async (...args) => {
        rpcCalls.push({ client: "service-role", args });
        return { error: null };
      }),
    };

    const plan = buildPlanWithBookings();
    await executeContainmentPlan(admin as never, plan, {
      authDeps: buildMagicLinkAuthDeps({
        rpcImpl: async (...args) => {
          rpcCalls.push({ client: "authenticated", args });
          return { error: null };
        },
      }),
    });

    expect(admin.rpc).not.toHaveBeenCalled();
    expect(rpcCalls.some((row) => row.client === "authenticated")).toBe(true);
    expect(rpcCalls.some((row) => row.client === "service-role")).toBe(false);
  });

  it("runs cancel_booking before caller identity containment", async () => {
    const order: string[] = [];
    const bookingId = "4a221111-1111-4111-8111-111111116208";
    let getUserCalls = 0;
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => {
            getUserCalls += 1;
            if (getUserCalls === 1) {
              return {
                data: { user: { id: CALLER_ID, email: "qa-admin@famio.local", banned_until: null } },
                error: null,
              };
            }
            return {
              data: {
                user: {
                  id: CALLER_ID,
                  email: "qa-admin@famio.local",
                  banned_until: new Date(Date.now() + 86400000).toISOString(),
                  ban_duration: "876000h",
                },
              },
              error: null,
            };
          }),
          updateUserById: vi.fn(async () => {
            order.push("ban_auth");
            return { error: null };
          }),
          signOut: vi.fn(async () => {
            order.push("signOut");
            return { error: null };
          }),
        },
      },
      from: mockAdminTables({
        onSuspend: () => order.push("suspend_profile"),
        onRemoveAdmin: () => order.push("remove_admin_role"),
      }),
      rpc: vi.fn(),
    };

    const plan = buildPlanWithBookings({
      identities: [eligibleAdmin()],
      bookings: [{ id: bookingId, status: "pending", notes: "QA booking", hasCancellationRecord: false }],
    });

    await executeContainmentPlan(admin as never, plan, {
      authDeps: buildMagicLinkAuthDeps({
        rpcImpl: async () => {
          order.push("cancel_booking");
          return { error: null };
        },
      }),
    });

    expect(order.indexOf("cancel_booking")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("ban_auth")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("cancel_booking")).toBeLessThan(order.indexOf("ban_auth"));
    expect(order.indexOf("signOut")).toBeLessThan(order.indexOf("ban_auth"));
  });

  it("contains other identities before the caller identity", async () => {
    const order: string[] = [];
    const otherUserId = "eeee1111-1111-4111-8111-111111111111";
    const bannedUsers = new Set<string>();
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async (userId) => ({
            data: {
              user: {
                id: userId,
                email: "qa-user@famio.local",
                banned_until: bannedUsers.has(userId) ? new Date(Date.now() + 86400000).toISOString() : null,
                ban_duration: bannedUsers.has(userId) ? "876000h" : undefined,
              },
            },
            error: null,
          })),
          updateUserById: vi.fn(async (userId) => {
            bannedUsers.add(userId);
            order.push(`ban_auth:${userId === CALLER_ID ? "caller" : "other"}`);
            return { error: null };
          }),
          signOut: vi.fn(async () => ({ error: null })),
        },
      },
      from: mockAdminTables({
        onSuspend: () => order.push("suspend_profile"),
        onRemoveAdmin: () => order.push("remove_admin_role"),
      }),
      rpc: vi.fn(),
    };

    const plan = buildContainmentPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      cancellationReasonId: REASON_ID,
      identities: [
        eligibleAdmin(),
        {
          userId: otherUserId,
          email: "qa-other@famio.local",
          fullName: "QA_other",
          authBanned: false,
          profileSuspended: false,
          hasAdminRole: false,
          inRegistry: true,
        },
      ],
      bookings: [{
        id: "4a221111-1111-4111-8111-111111116208",
        status: "pending",
        notes: "QA booking",
        hasCancellationRecord: false,
      }],
    });

    await executeContainmentPlan(admin as never, plan, {
      authDeps: buildMagicLinkAuthDeps({
        rpcImpl: async () => {
          order.push("cancel_booking");
          return { error: null };
        },
      }),
    });

    expect(order.indexOf("ban_auth:other")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("ban_auth:caller")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("ban_auth:other")).toBeLessThan(order.indexOf("ban_auth:caller"));
  });

  it("verifies four successful cancellations", async () => {
    const bookingIds = [
      "4a221111-1111-4111-8111-111111116201",
      "4a221111-1111-4111-8111-111111116202",
      "4a221111-1111-4111-8111-111111116203",
      "4a221111-1111-4111-8111-111111116204",
    ];
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: CALLER_ID, email: "qa-admin@famio.local", banned_until: null } },
            error: null,
          })),
          signOut: vi.fn(async () => ({ error: null })),
        },
      },
      from: mockAdminTables(),
      rpc: vi.fn(),
    };

    const plan = buildContainmentPlanFromSnapshot({
      projectRef: KNOWN_QA_PROJECT_REF,
      cancellationReasonId: REASON_ID,
      identities: [eligibleAdmin()],
      bookings: bookingIds.map((id) => ({
        id,
        status: "pending",
        notes: "QA booking",
        hasCancellationRecord: false,
      })),
    });

    const execution = await executeContainmentPlan(admin as never, plan, {
      authDeps: buildMagicLinkAuthDeps(),
    });

    expect(execution.results.filter((row) => row.actionType === "cancel_booking" && row.ok)).toHaveLength(4);
  });

  it("revokes session and stops later containment when cancellation fails", async () => {
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: CALLER_ID, email: "qa-admin@famio.local", banned_until: null } },
            error: null,
          })),
          updateUserById: vi.fn(async () => ({ error: null })),
          signOut: vi.fn(async () => ({ error: null })),
        },
      },
      from: mockAdminTables(),
      rpc: vi.fn(),
    };

    const plan = buildPlanWithBookings();
    const execution = await executeContainmentPlan(admin as never, plan, {
      authDeps: buildMagicLinkAuthDeps({
        rpcImpl: async () => ({ error: { message: "cancel failed" } }),
      }),
    });

    expect(execution.aborted).toBe(true);
    expect(execution.activeOperationalResidueReduced).toBe(false);
    expect(admin.auth.admin.signOut).toHaveBeenCalledWith("jwt-token", "global");
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("passes the obtained JWT to admin.signOut(jwt, global)", async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: CALLER_ID, email: "qa-admin@famio.local", banned_until: null } },
            error: null,
          })),
          signOut,
        },
      },
      from: mockAdminTables(),
      rpc: vi.fn(),
    };

    const plan = buildPlanWithBookings();
    await executeContainmentPlan(admin as never, plan, {
      authDeps: buildMagicLinkAuthDeps(),
    });

    expect(signOut).toHaveBeenCalledWith("jwt-token", "global");
  });
});

describe("booking caller fingerprint and report hygiene", () => {
  it("extracts hashed token from generateLink response", () => {
    expect(extractHashedTokenFromGenerateLink({ properties: { hashed_token: "abc" } })).toBe("abc");
    expect(extractHashedTokenFromGenerateLink({ properties: {} })).toBeNull();
  });

  it("changes fingerprint when caller changes", () => {
    const actions = [{
      entityType: "booking",
      id: "4a221111-1111-4111-8111-111111116208",
      actionType: "cancel_booking",
      currentState: "pending",
      intendedState: "cancelled",
    }];
    const fp1 = fingerprintContainmentPlan(actions, KNOWN_QA_PROJECT_REF, {
      bookingCallerUserId: CALLER_ID,
      bookingCallerClass: BOOKING_CALLER_CLASS,
      callerAuthMode: CALLER_AUTH_MODE,
      cancellationReasonId: REASON_ID,
      bookings: [{ id: actions[0].id, status: "pending" }],
    });
    const fp2 = fingerprintContainmentPlan(actions, KNOWN_QA_PROJECT_REF, {
      bookingCallerUserId: OTHER_ADMIN_ID,
      bookingCallerClass: BOOKING_CALLER_CLASS,
      callerAuthMode: CALLER_AUTH_MODE,
      cancellationReasonId: REASON_ID,
      bookings: [{ id: actions[0].id, status: "pending" }],
    });
    expect(fp1).not.toBe(fp2);
    expect(fp1).not.toBe(INVALIDATED_CONTAINMENT_FINGERPRINT_V1);
    expect(fp1).not.toBe(INVALIDATED_CONTAINMENT_FINGERPRINT_V2);
  });

  it("never puts tokens, email, password, or full UUID into plan/report", () => {
    const plan = buildPlanWithBookings();
    expect(plan.callerAuthMode).toBe(CALLER_AUTH_MODE);
    const report = sanitizeContainmentPlanForReport(plan);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/@/);
    expect(serialized).not.toMatch(/eyJ/);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(CALLER_ID);
    expect(report.bookingCaller?.maskedId).toMatch(/^.{4}….{4}$/);
    expect(report.bookingCaller?.callerClass).toBe(BOOKING_CALLER_CLASS);
  });
});

describe("booking caller import safety", () => {
  it("importing containment CLI causes zero side effects", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-containment-caller-import-"));
    const script = `
      process.chdir(${JSON.stringify(tmpDir)});
      process.argv = ["node", "ignored-entry.mjs", "--execute", "--confirm=I-UNDERSTAND-QA-CONTAINMENT", "--plan-fingerprint=${"c".repeat(64)}"];
      await import(${JSON.stringify(containmentModuleUrl())});
      console.log("IMPORT_OK");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, FAMY_ENV: "qa" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });
});

describe("session revocation helper", () => {
  it("uses admin.signOut(jwt, global)", async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    const admin = { auth: { admin: { signOut } } };
    const result = await revokeBookingCallerSession(admin as never, "jwt-token");
    expect(result.ok).toBe(true);
    expect(signOut).toHaveBeenCalledWith("jwt-token", "global");
  });
});
