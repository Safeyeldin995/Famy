import { describe, expect, it } from "vitest";
import { buildApplyDocumentChecklist } from "../applyDocumentChecklist";

describe("buildApplyDocumentChecklist", () => {
  it("lists identity docs with status and highlights rejected when changes requested", () => {
    const items = buildApplyDocumentChecklist({
      selectedServiceIds: ["svc-1"],
      requirements: [],
      documents: [
        { type: "id_card_front", status: "rejected", rejected_reason: "الصورة مش واضحة" },
        { type: "id_card_back", status: "pending" },
      ],
      changesRequested: true,
    });
    expect(items[0]).toMatchObject({
      key: "id_card_front",
      status: "needs_change",
      highlight: true,
      reason: "الصورة مش واضحة",
    });
    expect(items[1]?.status).toBe("pending");
  });

  it("adds evidence requirements for selected services only", () => {
    const items = buildApplyDocumentChecklist({
      selectedServiceIds: ["svc-a"],
      requirements: [
        {
          id: "r1",
          service_id: "svc-a",
          name_en: "First aid",
          name_ar: "إسعافات",
          required_for_provider_approval: true,
          evidence_required: true,
        },
        {
          id: "r2",
          service_id: "svc-b",
          name_en: "Other",
          name_ar: "تاني",
          required_for_provider_approval: true,
          evidence_required: true,
        },
      ],
      documents: [],
    });
    expect(items.filter((i) => i.kind === "requirement")).toHaveLength(1);
    expect(items.find((i) => i.key === "r1")?.label).toBe("إسعافات");
  });

  it("maps requirement fulfillments to checklist statuses", () => {
    const items = buildApplyDocumentChecklist({
      selectedServiceIds: ["svc-a"],
      requirements: [
        {
          id: "r1",
          service_id: "svc-a",
          name_en: "First aid",
          name_ar: "إسعافات",
          required_for_provider_approval: true,
          evidence_required: true,
        },
        {
          id: "r2",
          service_id: "svc-a",
          name_en: "Other",
          name_ar: "تاني",
          required_for_provider_approval: true,
          evidence_required: true,
        },
      ],
      documents: [],
      fulfillments: [
        {
          requirement_id: "r1",
          status: "pending",
          evidence_storage_path: "prov/r1.pdf",
        },
        {
          requirement_id: "r2",
          status: "failed",
          review_notes: "الملف قديم",
        },
      ],
      changesRequested: true,
    });
    expect(items.find((i) => i.key === "r1")?.status).toBe("pending");
    expect(items.find((i) => i.key === "r2")?.status).toBe("needs_change");
    expect(items.find((i) => i.key === "r2")?.reason).toBe("الملف قديم");
    expect(items.find((i) => i.key === "r2")?.highlight).toBe(true);
  });
});
