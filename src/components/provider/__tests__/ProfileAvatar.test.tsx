import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProfileAvatar } from "../ProfileAvatar";
const state = vi.hoisted(() => ({ url: null as string | null }));
vi.mock("@/lib/db/queries", () => ({ useAvatarUrl: () => ({ data: state.url }) }));
afterEach(() => {
  cleanup();
  state.url = null;
});
it("shows a first-letter fallback for a missing or failed avatar", () => {
  const { rerender } = render(<ProfileAvatar name="منى" />);
  expect(screen.getByRole("img", { name: "منى" }).textContent).toBe("م");
  state.url = "/synthetic-avatar.png";
  rerender(<ProfileAvatar name="منى" src="stored-path" />);
  fireEvent.error(screen.getByRole("img", { name: "منى" }));
  expect(screen.getByRole("img", { name: "منى" }).textContent).toBe("م");
  expect(document.querySelector("img")).toBeNull();
  rerender(<ProfileAvatar name="منى" src="stored-path" preview="blob:synthetic" />);
  expect(screen.getByRole("img", { name: "منى" }).getAttribute("src")).toBe("blob:synthetic");
});
