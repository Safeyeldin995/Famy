import type { Database } from "@/integrations/supabase/types";
import { expandChipsToCatalogueCodes } from "@/lib/provider/ageGroupCapabilities";

export type TeachingGroupDraft = {
  subject_id: string;
  curriculum_id: string;
  level_ids: string[];
  session_duration_min: number;
  session_price: number;
};

export type RequirementFulfillmentDraft = {
  requirement_id: string;
  notes?: string | null;
  evidence_storage_path?: string | null;
};

export type ServiceRequestPayload = {
  price_override?: number | null;
  teaching_groups?: TeachingGroupDraft[];
  max_children_per_booking?: number;
  age_group_capabilities?: Array<{
    age_group_code: string;
    years_experience?: number | null;
    note?: string | null;
  }>;
  requirement_fulfillments?: RequirementFulfillmentDraft[];
};

type FulfillmentRow = Pick<
  Database["public"]["Tables"]["provider_requirement_fulfillments"]["Row"],
  "requirement_id" | "notes" | "evidence_storage_path"
>;

export function buildRequirementFulfillmentPayload(
  requirementIds: string[],
  fulfillments: FulfillmentRow[],
): RequirementFulfillmentDraft[] {
  const byId = new Map(fulfillments.map((row) => [row.requirement_id, row]));
  const out: RequirementFulfillmentDraft[] = [];
  for (const requirementId of requirementIds) {
    const row = byId.get(requirementId);
    if (!row) continue;
    out.push({
      requirement_id: requirementId,
      notes: row.notes ?? null,
      evidence_storage_path: row.evidence_storage_path ?? null,
    });
  }
  return out;
}

export function buildAgeGroupsFromChips(
  chipIds: string[],
  yearsByChip: Record<string, number | "">,
  noteByChip: Record<string, string>,
) {
  return expandChipsToCatalogueCodes(chipIds).map((code) => ({
    age_group_code: code,
    years_experience:
      yearsByChip[code] === "" || yearsByChip[code] == null ? null : Number(yearsByChip[code]),
    note: noteByChip[code]?.trim() || null,
  }));
}

export function validateTeachingGroups(groups: TeachingGroupDraft[]): string | null {
  if (groups.length === 0) return "teaching_required";
  for (const group of groups) {
    if (
      !group.subject_id ||
      !group.curriculum_id ||
      !group.level_ids?.length ||
      !group.session_duration_min ||
      group.session_price == null
    ) {
      return "teaching_incomplete";
    }
  }
  return null;
}
