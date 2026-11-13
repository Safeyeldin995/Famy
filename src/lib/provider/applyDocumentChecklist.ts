export type ProviderDocumentRow = {
  type: string;
  status: string;
  rejected_reason?: string | null;
};

export type ServiceRequirementRow = {
  id: string;
  service_id: string;
  name_en: string;
  name_ar: string;
  required_for_provider_approval: boolean;
  evidence_required: boolean;
  is_active?: boolean;
};

export type RequirementFulfillmentRow = {
  requirement_id: string;
  status: string;
  evidence_storage_path?: string | null;
  notes?: string | null;
  review_notes?: string | null;
};

export type ApplyChecklistItemKind = "identity" | "requirement";

export type ApplyDocumentChecklistItem = {
  kind: ApplyChecklistItemKind;
  key: string;
  labelKey?: string;
  label?: string;
  status: "saved" | "pending" | "approved" | "needs_change" | "missing";
  highlight: boolean;
  reason?: string | null;
};

const APPLY_IDENTITY_TYPES = ["id_card_front", "id_card_back"] as const;

const identityLabelKey: Record<(typeof APPLY_IDENTITY_TYPES)[number], string> = {
  id_card_front: "providerDocuments.id_card_front",
  id_card_back: "providerDocuments.id_card_back",
};

function mapDocumentStatus(
  doc: ProviderDocumentRow | undefined,
  captured: boolean,
): ApplyDocumentChecklistItem["status"] {
  if (!doc) return captured ? "saved" : "missing";
  if (doc.status === "approved") return "approved";
  if (doc.status === "rejected") return "needs_change";
  if (doc.status === "pending") return "pending";
  return captured ? "saved" : "missing";
}

function mapRequirementFulfillmentStatus(
  fulfillment: RequirementFulfillmentRow | undefined,
): Pick<ApplyDocumentChecklistItem, "status" | "highlight" | "reason"> {
  if (!fulfillment) {
    return { status: "missing", highlight: false };
  }
  if (fulfillment.status === "passed" || fulfillment.status === "waived") {
    return { status: "approved", highlight: false };
  }
  if (fulfillment.status === "failed") {
    return {
      status: "needs_change",
      highlight: false,
      reason: fulfillment.review_notes ?? null,
    };
  }
  const hasEvidence = !!fulfillment.evidence_storage_path?.trim();
  if (hasEvidence) return { status: "pending", highlight: false };
  if (fulfillment.notes?.trim()) return { status: "saved", highlight: false };
  return { status: "missing", highlight: false };
}

export function buildApplyDocumentChecklist(input: {
  selectedServiceIds: string[];
  requirements: ServiceRequirementRow[];
  documents: ProviderDocumentRow[];
  fulfillments?: RequirementFulfillmentRow[];
  captured?: { front?: boolean; back?: boolean };
  changesRequested?: boolean;
}): ApplyDocumentChecklistItem[] {
  const docsByType = new Map(input.documents.map((d) => [d.type, d]));
  const fulfillmentByReq = new Map(
    (input.fulfillments ?? []).map((row) => [row.requirement_id, row]),
  );
  const items: ApplyDocumentChecklistItem[] = [];

  for (const type of APPLY_IDENTITY_TYPES) {
    const doc = docsByType.get(type);
    const captured =
      type === "id_card_front" ? input.captured?.front : input.captured?.back;
    items.push({
      kind: "identity",
      key: type,
      labelKey: identityLabelKey[type],
      status: mapDocumentStatus(doc, !!captured),
      highlight: input.changesRequested === true && doc?.status === "rejected",
      reason: doc?.status === "rejected" ? doc.rejected_reason ?? null : null,
    });
  }

  const selected = new Set(input.selectedServiceIds);
  const seen = new Set<string>();
  for (const req of input.requirements) {
    if (!req.is_active && req.is_active !== undefined) continue;
    if (!selected.has(req.service_id)) continue;
    if (!req.required_for_provider_approval || !req.evidence_required) continue;
    if (seen.has(req.id)) continue;
    seen.add(req.id);
    const fulfillment = fulfillmentByReq.get(req.id);
    const mapped = mapRequirementFulfillmentStatus(fulfillment);
    items.push({
      kind: "requirement",
      key: req.id,
      label: req.name_ar || req.name_en,
      status: mapped.status,
      highlight: input.changesRequested === true && fulfillment?.status === "failed",
      reason: mapped.reason,
    });
  }

  return items;
}

export function applyChecklistStatusLabelKey(status: ApplyDocumentChecklistItem["status"]): string {
  return `providerApply.checklistStatus.${status}`;
}
