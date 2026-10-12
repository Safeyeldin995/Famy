import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/famio/ProviderShell", () => ({
  ProviderShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/famio/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("@/lib/provider/onboarding-queries", () => ({
  onboardingEditable: (status: string) => status === "DRAFT" || status === "NEEDS_CHANGES",
}));
import { canUploadDocument, ProviderDocumentsView } from "../ProviderDocumentsView";
const document = {
  id: "test",
  type: "id_card_front" as const,
  status: "rejected" as const,
  rejected_reason: "Public reason",
  notes: "Internal note",
  storage_path: "private/evidence",
};
afterEach(cleanup);
it("matches the existing prepare/finalize upload status gates", () => {
  for (const status of ["DRAFT", "NEEDS_CHANGES"] as const) {
    expect(canUploadDocument(status, "id_card_front")).toBe(true);
    expect(canUploadDocument(status, "certificate")).toBe(true);
  }
  for (const status of [
    "SUBMITTED",
    "UNDER_REVIEW",
    "APPROVED",
    "REJECTED",
    "SUSPENDED",
  ] as const) {
    expect(canUploadDocument(status, "id_card_front")).toBe(false);
    expect(canUploadDocument(status, "certificate")).toBe(false);
    expect(canUploadDocument(status, "profile_photo")).toBe(
      status === "SUBMITTED" || status === "UNDER_REVIEW",
    );
  }
  expect(canUploadDocument(undefined, "id_card_front")).toBe(false);
});
it("shows only public document information with no uploads for approved providers", () => {
  const { container } = render(
    <ProviderDocumentsView status="APPROVED" documents={[document]} onUpload={vi.fn()} />,
  );
  expect(screen.getByText("Public reason")).toBeTruthy();
  expect(container.textContent).not.toContain("Internal note");
  expect(container.innerHTML).not.toContain("private/evidence");
  expect(container.querySelector('input[type="file"]')).toBeNull();
});
it("passes a replacement file and its type to the secure upload handler", () => {
  const upload = vi.fn();
  render(<ProviderDocumentsView status="NEEDS_CHANGES" documents={[document]} onUpload={upload} />);
  const file = new File(["fixture"], "fixture.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("providerDocuments.id_card_front"), {
    target: { files: [file] },
  });
  expect(upload).toHaveBeenCalledWith("id_card_front", file);
});

it("places each ID status inside its card and the public reason directly below", () => {
  render(
    <ProviderDocumentsView
      status="APPROVED"
      documents={[
        document,
        { id: "back", type: "id_card_back", status: "pending", rejected_reason: null },
      ]}
      onUpload={vi.fn()}
    />,
  );
  const front = screen.getByText("providerDocuments.id_card_front").closest(".apply-id");
  const back = screen.getByText("providerDocuments.id_card_back").closest(".apply-id");
  expect(front?.contains(screen.getByText("providerDocuments.rejected"))).toBe(true);
  expect(back?.contains(screen.getByText("providerDocuments.pending"))).toBe(true);
  expect(front?.nextElementSibling).toBe(screen.getByText("Public reason"));
  expect(screen.queryByText("providerApply.captured")).toBeNull();
});
it("keeps other document tiles, labels and status tags in the same row", () => {
  render(
    <ProviderDocumentsView
      status="APPROVED"
      documents={[{ ...document, type: "certificate", status: "approved", rejected_reason: null }]}
      onUpload={vi.fn()}
    />,
  );
  const row = screen.getByText("providerDocuments.certificate").closest(".apply-li");
  expect(row?.querySelector(".apply-tile")).toBeTruthy();
  expect(row?.contains(screen.getByText("providerDocuments.approved"))).toBe(true);
});
