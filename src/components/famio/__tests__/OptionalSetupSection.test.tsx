import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OptionalSetupSection, setupGroupHasData } from "../OptionalSetupSection";
afterEach(cleanup);
it("opens only groups containing saved or draft values", () => {
  expect(setupGroupHasData(["", null, undefined, "  "])).toBe(false);
  expect(setupGroupHasData(["curriculum", ""])).toBe(true);
  expect(setupGroupHasData(["", "level"])).toBe(true);
  expect(setupGroupHasData(["", "", "0"])).toBe(true);
});
it("opens on hydrated data and collapsing leaves the mounted field value intact", async () => {
  const field = <input aria-label="Optional detail" defaultValue="Draft detail" />;
  const { container, rerender } = render(
    <OptionalSetupSection title="Details" hasData={false}>
      {field}
    </OptionalSetupSection>,
  );
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  rerender(
    <OptionalSetupSection title="Details" hasData>
      {field}
    </OptionalSetupSection>,
  );
  await waitFor(() => expect(details.open).toBe(true));
  details.open = false;
  fireEvent(details, new Event("toggle"));
  expect((container.querySelector("input") as HTMLInputElement).value).toBe("Draft detail");
  expect(details.open).toBe(false);
});
