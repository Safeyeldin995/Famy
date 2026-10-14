import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminPicker } from "../AdminPicker";
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
describe("admin sheet picker", () => {
  it("preserves exact backend values and changes only on selection", () => {
    const change = vi.fn();
    render(
      <AdminPicker value="" onChange={change} aria-label="فلتر">
        <option value="">الكل</option>
        <option value="pending_review">مستني مراجعة</option>
      </AdminPicker>,
    );
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "فلتر" }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "مستني مراجعة" }));
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0][0].target.value).toBe("pending_review");
  });
  it("cancel and disabled controls never change the filter", () => {
    const change = vi.fn();
    const { rerender } = render(
      <AdminPicker value="all" onChange={change} aria-label="فلتر">
        <option value="all">الكل</option>
      </AdminPicker>,
    );
    fireEvent.click(screen.getByRole("button", { name: "فلتر" }));
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(change).not.toHaveBeenCalled();
    rerender(
      <AdminPicker disabled value="all" onChange={change} aria-label="فلتر">
        <option value="all">الكل</option>
      </AdminPicker>,
    );
    fireEvent.click(screen.getByRole("button", { name: "فلتر" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
});
