import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProfileAvatar } from "../ProfileAvatar";
const state = vi.hoisted(() => ({ url: null as string | null }));
vi.mock("@/lib/db/queries", () => ({ useAvatarUrl: () => ({ data: state.url }) }));
afterEach(() => {
  cleanup();
  state.url = null;
});
it.each(["h-11 w-11 rounded-full", "h-12 w-12 shrink-0 rounded-xl"])(
  "keeps the initial visible until loading succeeds and restores it onError (%s)",
  (className) => {
    state.url = "/customer.png";
    const { rerender } = render(<ProfileAvatar decorative={false} name="Mona" src="stored-path" className={className} />);
    const image = screen.getByRole("img", { name: "Mona" });
    expect(screen.getByText("M")).toBeTruthy();
    expect((image as HTMLImageElement).style.opacity).toBe("0");
    fireEvent.load(image);
    expect(screen.queryByText("M")).toBeNull();
    expect((image as HTMLImageElement).style.opacity).toBe("1");
    fireEvent.error(image);
    expect(screen.getByRole("img", { name: "Mona" }).textContent).toBe("M");
    expect(document.querySelector("img")).toBeNull();
    state.url = "/replacement.png";
    rerender(<ProfileAvatar decorative={false} name="Mona" src="replacement" className={className} />);
    expect((screen.getByRole("img", { name: "Mona" }) as HTMLImageElement).style.opacity).toBe("0");
    fireEvent.error(screen.getByRole("img", { name: "Mona" }));
    expect(screen.getByRole("img", { name: "Mona" }).textContent).toBe("M");
  },
);
it("shows a first-letter fallback for a missing or failed avatar", () => {
  const { rerender } = render(<ProfileAvatar decorative={false} name="منى" />);
  expect(screen.getByRole("img", { name: "منى" }).textContent).toBe("م");
  state.url = "/synthetic-avatar.png";
  rerender(<ProfileAvatar decorative={false} name="منى" src="stored-path" />);
  fireEvent.error(screen.getByRole("img", { name: "منى" }));
  expect(screen.getByRole("img", { name: "منى" }).textContent).toBe("م");
  expect(document.querySelector("img")).toBeNull();
  rerender(<ProfileAvatar decorative={false} name="منى" src="stored-path" preview="blob:synthetic" />);
  expect(screen.getByRole("img", { name: "منى" }).getAttribute("src")).toBe("blob:synthetic");
});

it("hides decorative avatars from screen readers and gives loaded images a solid background", () => {
  state.url = "/transparent.png";
  const { container } = render(<ProfileAvatar name="Mona" />);
  const image = container.querySelector("img")!;
  expect(image.alt).toBe("");
  expect(image.getAttribute("aria-hidden")).toBe("true");
  expect(image.classList.contains("bg-white")).toBe(true);
  expect(screen.queryByRole("img")).toBeNull();
  fireEvent.load(image);
  expect(screen.queryByText("M")).toBeNull();
  fireEvent.error(image);
  expect(screen.getByText("M")).toBeTruthy();
});
