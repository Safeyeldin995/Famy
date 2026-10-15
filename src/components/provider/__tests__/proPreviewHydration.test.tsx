import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { useProPath } from "@/lib/provider/useProPath";

function Links() {
  const path = useProPath();
  return (
    <>
      <a href={path("/pro/setup/subjects")}>Subjects</a>
      <a href={path("/home")}>Customer</a>
    </>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});
it.each([
  "/preview/pro?pending=1",
  "/preview/pro?pending=changes",
  "/preview/pro/profile",
  "/preview/pro/notification-preferences",
  "/pro/profile",
])("hydrates identical hrefs on %s before enabling preview links", async (url) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({}, "", url);
  const container = document.createElement("div");
  container.innerHTML = renderToString(<Links />);
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/pro/setup/subjects");
  document.body.append(container);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const recoverable = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <Links />, { onRecoverableError: recoverable });
    });
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      url.startsWith("/preview/pro") ? "/preview/pro/setup/subjects" : "/pro/setup/subjects",
    );
    expect(container.querySelectorAll("a")[1].getAttribute("href")).toBe("/home");
    expect(errors).not.toHaveBeenCalled();
    expect(recoverable).not.toHaveBeenCalled();
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});
