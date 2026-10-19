import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { BottomSheetMultiSelect } from "../BottomSheetMultiSelect";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "rtl" } }),
}));
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
afterEach(cleanup);
it("selects all grades, keeps approved grades checked when clearing, and closes on Done", () => {
  function Field() {
    const [value, setValue] = useState(["approved"]);
    return (
      <BottomSheetMultiSelect
        label="Grades"
        summary={value.join(", ")}
        value={value}
        options={[
          { value: "approved", label: "Approved grade", locked: true },
          { value: "pending", label: "Pending grade" },
        ]}
        onChange={setValue}
      />
    );
  }
  render(<Field />);
  fireEvent.click(screen.getByRole("button", { name: "Grades" }));
  const approved = screen.getByRole("checkbox", { name: "Approved grade" }) as HTMLInputElement;
  const pending = screen.getByRole("checkbox", { name: "Pending grade" }) as HTMLInputElement;
  expect(approved.disabled).toBe(true);
  expect(approved.checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "providerClarity.selectAll" }));
  expect(pending.checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "providerClarity.selectAll" }));
  expect(pending.checked).toBe(false);
  expect(approved.checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "common.done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
