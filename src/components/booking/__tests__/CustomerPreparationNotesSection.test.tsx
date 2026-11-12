import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createInstance, type i18n as I18n } from "i18next";
import en from "@/lib/i18n/locales/en";
import { CustomerPreparationNotesSection } from "../CustomerPreparationNotesSection";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  const ar = (await import("@/lib/i18n/locales/ar")).default;
  await i18n.init({ lng: "ar", resources: { ar: { translation: ar } } });
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (...args: Parameters<I18n["t"]>) => i18n.t(...args), i18n }),
}));

function renderSection(notes: string | null | undefined) {
  return render(<CustomerPreparationNotesSection notes={notes} />);
}

describe("CustomerPreparationNotesSection", () => {
  it("renders nothing when notes are empty", () => {
    renderSection("   ");
    expect(screen.queryByText(i18n.t("customerPreparation.sectionTitle"))).toBeNull();
  });

  it("shows the section when notes are set", () => {
    renderSection("كتب الرياضيات\nقلم وورقة");
    expect(screen.getByText(/كتب الرياضيات/)).toBeTruthy();
    expect(screen.getByText(i18n.t("customerPreparation.sectionTitle"))).toBeTruthy();
  });
});
