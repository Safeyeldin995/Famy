export type EligibilityReasonAction =
  | { kind: "link"; path: string; hash?: string }
  | { kind: "service"; serviceId: string }
  | { kind: "info" };

export type MappedEligibilityReason = {
  i18nKey: string;
  action: EligibilityReasonAction;
};

const EXACT_REASON_MAP: Record<string, MappedEligibilityReason> = {
  "Provider has no valid availability": {
    i18nKey: "pro.profile.eligibilityReasons.noAvailability",
    action: { kind: "link", path: "/pro/availability" },
  },
  "Active Provider and Service zone coverage is missing": {
    i18nKey: "pro.profile.eligibilityReasons.missingZone",
    action: { kind: "link", path: "/pro/onboarding" },
  },
  "Provider price is missing or outside Admin limits": {
    i18nKey: "pro.profile.eligibilityReasons.invalidPrice",
    action: { kind: "info" },
  },
  "No approved teaching subject with a valid session price": {
    i18nKey: "pro.profile.eligibilityReasons.teachingPrice",
    action: { kind: "link", path: "/pro/profile", hash: "teaching-subjects" },
  },
  "Provider-service relationship is not approved": {
    i18nKey: "pro.profile.eligibilityReasons.serviceNotApproved",
    action: { kind: "info" },
  },
  "Provider is not verified or onboarding is not approved": {
    i18nKey: "pro.profile.eligibilityReasons.notApproved",
    action: { kind: "info" },
  },
  "Provider account is inactive, not approved, deleted, or in vacation mode": {
    i18nKey: "pro.profile.eligibilityReasons.accountInactive",
    action: { kind: "info" },
  },
  "Provider is not verified": {
    i18nKey: "pro.profile.eligibilityReasons.notVerified",
    action: { kind: "info" },
  },
  "Mandatory Provider requirements are incomplete": {
    i18nKey: "pro.profile.eligibilityReasons.requirementsIncomplete",
    action: { kind: "info" },
  },
  "Required evidence is missing or not approved": {
    i18nKey: "pro.profile.eligibilityReasons.evidenceMissing",
    action: { kind: "info" },
  },
  "Service is inactive or hidden from Customers": {
    i18nKey: "pro.profile.eligibilityReasons.serviceInactive",
    action: { kind: "info" },
  },
  "Babysitting maximum children or age-group capabilities are not declared": {
    i18nKey: "pro.profile.eligibilityReasons.babysittingUndeclared",
    action: { kind: "link", path: "/pro/onboarding" },
  },
};

export function mapMarketplaceEligibilityFailureReason(
  reason: string,
  serviceId?: string,
  providerZoneCount = 0,
): MappedEligibilityReason {
  if (/zone coverage/i.test(reason) && providerZoneCount > 0) {
    return {
      i18nKey: "pro.profile.eligibilityReasons.zoneUnavailable",
      action: { kind: "info" },
    };
  }
  const exact = EXACT_REASON_MAP[reason];
  if (exact) {
    if (exact.i18nKey === "pro.profile.eligibilityReasons.invalidPrice" && serviceId) {
      return { ...exact, action: { kind: "service", serviceId } };
    }
    return exact;
  }
  if (/price/i.test(reason) && serviceId) {
    return {
      i18nKey: "pro.profile.eligibilityReasons.invalidPrice",
      action: { kind: "service", serviceId },
    };
  }
  if (/zone coverage/i.test(reason)) {
    return EXACT_REASON_MAP["Active Provider and Service zone coverage is missing"];
  }
  if (/not approved|not verified/i.test(reason)) {
    return EXACT_REASON_MAP["Provider is not verified or onboarding is not approved"];
  }
  return {
    i18nKey: "pro.profile.eligibilityReasons.generic",
    action: { kind: "info" },
  };
}

export function dedupeEligibilityReasons(
  rows: Array<{ service_id: string; failure_reasons?: string[] | null }>,
  providerZoneCount = 0,
): Array<{ reason: string; serviceIds: string[]; mapped: MappedEligibilityReason }> {
  const byKey = new Map<
    string,
    { reason: string; serviceIds: Set<string>; mapped: MappedEligibilityReason }
  >();
  for (const row of rows) {
    for (const reason of row.failure_reasons ?? []) {
      const mapped = mapMarketplaceEligibilityFailureReason(
        reason,
        row.service_id,
        providerZoneCount,
      );
      const key = `${mapped.i18nKey}::${mapped.action.kind}::${
        mapped.action.kind === "link"
          ? `${mapped.action.path}#${mapped.action.hash ?? ""}`
          : mapped.action.kind === "service"
            ? "service"
            : "info"
      }`;
      const existing = byKey.get(key);
      if (existing) {
        existing.serviceIds.add(row.service_id);
      } else {
        byKey.set(key, {
          reason,
          serviceIds: new Set([row.service_id]),
          mapped,
        });
      }
    }
  }
  return [...byKey.values()].map((entry) => ({
    reason: entry.reason,
    serviceIds: [...entry.serviceIds],
    mapped: entry.mapped,
  }));
}

export function marketplaceEligibilityStatus(
  rows: Array<{ service_id: string; is_eligible: boolean; failure_reasons?: string[] | null }>,
  providerZoneCount = 0,
) {
  const visible = rows.some((row) => row.is_eligible);
  return {
    visible,
    i18nKey: visible ? "pro.profile.visibleToCustomers" : "pro.profile.notVisibleToCustomers",
    stepsLeft: visible ? 0 : dedupeEligibilityReasons(rows, providerZoneCount).length,
  };
}
