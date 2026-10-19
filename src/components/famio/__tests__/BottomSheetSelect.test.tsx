import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BottomSheetSelect } from "../BottomSheetSelect";
import "@/lib/i18n";

const originalScroll = HTMLElement.prototype.scrollIntoView;
afterEach(() => {
  cleanup();
  HTMLElement.prototype.scrollIntoView = originalScroll;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("centres the saved option when opening without changing the saved value", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  const onChange = vi.fn();
  render(
    <BottomSheetSelect
      label="Time"
      value="09:00"
      options={[
        { value: "00:00", label: "12 AM" },
        { value: "09:00", label: "9 AM" },
        { value: "12:00", label: "12 PM" },
      ]}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Time" }));
  const selected = await screen.findByRole("option", { name: "9 AM" });
  await waitFor(() =>
    expect(
      scroll.mock.calls.some(
        (args, i) => args[0]?.block === "center" && scroll.mock.contexts[i] === selected,
      ),
    ).toBe(true),
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(selected.getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("option", { name: "12 PM" }));
  expect(onChange).toHaveBeenCalledWith("12:00");
});
