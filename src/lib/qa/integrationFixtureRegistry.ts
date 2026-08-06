import { randomUUID } from "node:crypto";
// Canonical registry persistence — no duplicate file writes in TypeScript.
// @ts-expect-error — .mjs module has no generated declarations
import { registerUserEntry } from "../../../qa/registry.mjs";

export type RoleAssignment = { userId: string; role: string };

export type FixtureRegistrySnapshot = {
  runId: string;
  suite?: string;
  userIds: string[];
  adminUserIds: string[];
  roleAssignments: RoleAssignment[];
  addressIds: string[];
  bookingIds: string[];
  serviceIds: string[];
  zoneIds: string[];
  providerIds: string[];
  zoneProviderLinks: Array<{ zoneId: string; providerId: string }>;
  zoneServiceLinks: Array<{ zoneId: string; serviceId: string }>;
  providerServiceLinks: Array<{ providerId: string; serviceId: string }>;
  paymentIds: string[];
  failedCleanup: Array<{ id: string; kind: string; reason: string }>;
};

export class IntegrationFixtureRegistry {
  private readonly runId: string;
  private readonly suite?: string;
  private userIds = new Set<string>();
  private adminUserIds = new Set<string>();
  private roleAssignments: RoleAssignment[] = [];
  private addressIds = new Set<string>();
  private bookingIds = new Set<string>();
  private serviceIds = new Set<string>();
  private zoneIds = new Set<string>();
  private providerIds = new Set<string>();
  private zoneProviderLinks: Array<{ zoneId: string; providerId: string }> = [];
  private zoneServiceLinks: Array<{ zoneId: string; serviceId: string }> = [];
  private providerServiceLinks: Array<{ providerId: string; serviceId: string }> = [];
  private paymentIds = new Set<string>();
  private failedCleanup: Array<{ id: string; kind: string; reason: string }> = [];
  private tornDown = false;

  constructor(opts?: { suite?: string; runId?: string }) {
    this.suite = opts?.suite;
    this.runId = opts?.runId ?? randomUUID();
  }

  getRunId() {
    return this.runId;
  }

  registerUser(userId: string, opts?: { email?: string; admin?: boolean }) {
    this.userIds.add(userId);
    if (opts?.admin) this.adminUserIds.add(userId);
    if (opts?.email) {
      registerUserEntry({
        userId,
        email: opts.email,
        suite: this.suite,
        runId: this.runId,
      });
    }
    return userId;
  }

  registerRole(userId: string, role: string) {
    this.roleAssignments.push({ userId, role });
    if (role === "admin") this.adminUserIds.add(userId);
  }

  registerAddress(id: string) {
    this.addressIds.add(id);
  }

  registerBooking(id: string) {
    this.bookingIds.add(id);
  }

  registerService(id: string) {
    this.serviceIds.add(id);
  }

  registerZone(id: string) {
    this.zoneIds.add(id);
  }

  registerProvider(id: string) {
    this.providerIds.add(id);
  }

  registerZoneProvider(zoneId: string, providerId: string) {
    this.zoneProviderLinks.push({ zoneId, providerId });
  }

  registerZoneService(zoneId: string, serviceId: string) {
    this.zoneServiceLinks.push({ zoneId, serviceId });
  }

  registerProviderService(providerId: string, serviceId: string) {
    this.providerServiceLinks.push({ providerId, serviceId });
  }

  registerPayment(id: string) {
    this.paymentIds.add(id);
  }

  markCleanupFailed(id: string, kind: string, reason: string) {
    this.failedCleanup.push({ id, kind, reason });
  }

  getFailedCleanupIds() {
    return [...this.failedCleanup];
  }

  getRunOwnedAdminUserIds() {
    return [...this.adminUserIds];
  }

  snapshot(): FixtureRegistrySnapshot {
    return {
      runId: this.runId,
      suite: this.suite,
      userIds: [...this.userIds],
      adminUserIds: [...this.adminUserIds],
      roleAssignments: [...this.roleAssignments],
      addressIds: [...this.addressIds],
      bookingIds: [...this.bookingIds],
      serviceIds: [...this.serviceIds],
      zoneIds: [...this.zoneIds],
      providerIds: [...this.providerIds],
      zoneProviderLinks: [...this.zoneProviderLinks],
      zoneServiceLinks: [...this.zoneServiceLinks],
      providerServiceLinks: [...this.providerServiceLinks],
      paymentIds: [...this.paymentIds],
      failedCleanup: [...this.failedCleanup],
    };
  }

  markTornDown() {
    this.tornDown = true;
  }

  wasTornDown() {
    return this.tornDown;
  }
}

/** Ensures teardown runs even when seed/setup throws. */
export async function runRegisteredTeardown(
  registry: IntegrationFixtureRegistry,
  teardown: () => Promise<void>,
) {
  try {
    await teardown();
  } finally {
    registry.markTornDown();
  }
}
