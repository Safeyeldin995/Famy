import { describe, expect, it } from "vitest";
import {
  ZONE_DEACTIVATION_CONFIRM_VALUE,
  parseZoneDeactivationArgs,
} from "../zone-deactivation-args.mjs";
import { fingerprintZoneDeactivationPlan } from "../zone-deactivation-fingerprint.mjs";
import {
  ZONE_DEACTIVATION_V1_TARGETS,
  buildZoneDeactivationPlanFromSnapshot,
} from "../zone-deactivation-planner.mjs";
import { dryRunExitCode } from "../zone-deactivation-dry-run.mjs";
import { KNOWN_QA_PROJECT_REF } from "../qa-identity.mjs";

const ZERO_FK = { zone_services: 0, zone_providers: 0 };

function liveSnapshot(overrides: Record<string, Partial<{ row: any; childCounts: any }>> = {}) {
  const zonesById = Object.fromEntries(
    ZONE_DEACTIVATION_V1_TARGETS.map((target) => [
      target.id,
      {
        row: { id: target.id, name_en: target.name_en, is_active: true },
        childCounts: {
          ...ZERO_FK,
          addresses: target.expectedSpatialAddressCount,
        },
        ...(overrides[target.id] ?? {}),
      },
    ]),
  );
  return { projectRef: KNOWN_QA_PROJECT_REF, zonesById };
}

describe("zone deactivation args", () => {
  it("defaults to dry-run", () => {
    expect(parseZoneDeactivationArgs([])).toEqual({ mode: "dry-run" });
  });

  it("requires confirm phrase and fingerprint for execute", () => {
    expect(parseZoneDeactivationArgs(["--execute"]).mode).toBe("rejected");
    expect(
      parseZoneDeactivationArgs([
        "--execute",
        `--confirm=${ZONE_DEACTIVATION_CONFIRM_VALUE}`,
        `--plan-fingerprint=${"a".repeat(64)}`,
      ]).mode,
    ).toBe("execute");
  });
});

describe("zone deactivation planner", () => {
  it("locks to exactly two Issue #12 zones", () => {
    expect(ZONE_DEACTIVATION_V1_TARGETS).toHaveLength(2);
  });

  it("builds an unblocked deactivate-only plan when live state matches investigation", () => {
    const plan = buildZoneDeactivationPlanFromSnapshot(liveSnapshot());
    expect(plan.blocked).toBe(false);
    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.zones).toHaveLength(2);
    expect(plan.zones.every((zone) => zone.actionType === "deactivate_zone")).toBe(true);
    expect(plan.zones.every((zone) => zone.intendedIsActive === false)).toBe(true);
  });

  it("blocks when spatial address count drifts from investigation baseline", () => {
    const target = ZONE_DEACTIVATION_V1_TARGETS[0];
    const plan = buildZoneDeactivationPlanFromSnapshot(
      liveSnapshot({
        [target.id]: {
          childCounts: { ...ZERO_FK, addresses: target.expectedSpatialAddressCount + 1 },
        },
      }),
    );
    expect(plan.blocked).toBe(true);
    expect(plan.blockedReason).toContain("spatial-address-count-drift");
    expect(plan.fingerprint).toBeNull();
  });

  it("blocks when FK children exist", () => {
    const target = ZONE_DEACTIVATION_V1_TARGETS[1];
    const plan = buildZoneDeactivationPlanFromSnapshot(
      liveSnapshot({
        [target.id]: {
          childCounts: {
            zone_services: 1,
            zone_providers: 0,
            addresses: target.expectedSpatialAddressCount,
          },
        },
      }),
    );
    expect(plan.blocked).toBe(true);
    expect(plan.blockedReason).toContain("zone-has-fk-children");
  });

  it("invalidates fingerprint when any verified value changes", () => {
    const base = buildZoneDeactivationPlanFromSnapshot(liveSnapshot());
    const changed = fingerprintZoneDeactivationPlan({
      projectRef: KNOWN_QA_PROJECT_REF,
      blocked: false,
      zones: base.zones.map((zone, index) =>
        index === 0
          ? { ...zone, observedSpatialAddressCount: zone.observedSpatialAddressCount + 1 }
          : zone,
      ),
    });
    expect(changed).not.toBe(base.fingerprint);
  });
});

describe("zone deactivation dry-run exit codes", () => {
  it("returns 0 for unblocked dry-run and 2 for blocked", () => {
    expect(dryRunExitCode({ blocked: false })).toBe(0);
    expect(dryRunExitCode({ blocked: true })).toBe(2);
  });
});
