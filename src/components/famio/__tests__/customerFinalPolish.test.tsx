import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCustomerPreviewPath } from "../useCustomerPreviewPath";
import { CustomerFilterPicker } from "../CustomerFilterPicker";
import { latinCustomerText } from "../customerProviders";
import { formatNumber } from "@/lib/format";
import "@/lib/i18n";

const source = (file: string) => readFileSync(resolve("src", file), "utf8");
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("customer final polish", () => {
  it.each([
    "/preview/login",
    "/preview/otp",
    "/preview/favorites",
    "/preview/promo-codes",
    "/preview/help",
  ])("hydrates stable link attributes on %s, then enables preview navigation", async (path) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.history.replaceState({}, "", path);
    function Links() {
      const previewPath = useCustomerPreviewPath();
      return <a href={previewPath("/profile")}>Profile</a>;
    }
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Links />);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/profile");
    document.body.append(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <Links />, { onRecoverableError: recoverable });
    });
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/preview/profile");
    expect(errors).not.toHaveBeenCalled();
    expect(recoverable).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps normal customer links unchanged", () => {
    window.history.replaceState({}, "", "/login");
    function Link() {
      const path = useCustomerPreviewPath();
      return <a href={path("/profile")}>Profile</a>;
    }
    render(<Link />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/profile");
  });

  it("keeps native filter values when selecting a bottom-sheet option", async () => {
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
    const originalScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = () => {};
    const onChange = vi.fn();
    try {
      render(
        <CustomerFilterPicker
          label="Service"
          value=""
          options={[
            { value: "", label: "All services" },
            { value: "service-original-id", label: "Tutoring" },
          ]}
          onChange={onChange}
        />,
      );
      expect(document.querySelector("select")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Service" }));
      fireEvent.click(await screen.findByRole("option", { name: "Tutoring" }));
      expect(onChange).toHaveBeenCalledWith("service-original-id");
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScroll;
    }
  });

  it("renders Latin onboarding numbers and promo description digits without changing content", () => {
    expect(formatNumber(1, "ar")).toBe("1");
    expect(formatNumber(3, "ar")).toBe("3");
    expect(latinCustomerText("خصم ٢٠٪ على أول حجز")).toBe("خصم 20٪ على أول حجز");
    expect(source("routes/onboarding.tsx")).toContain("formatNumber(i + 1, lang)");
    expect(source("routes/promo-codes.tsx")).toContain("latinCustomerText(description)");
    expect(source("routes/promo-codes.tsx")).toContain("copyPromoCode(offer.code, t)");
  });

  it("protects the audited touch targets and typography", () => {
    const login = source("routes/login.tsx");
    expect(login).toContain("focus-ring min-h-11 -mb-px");
    expect(login).toContain("inline-flex min-h-11 shrink-0");
    expect(login).toContain("h-11 w-11 shrink-0");
    expect(source("routes/otp.tsx")).toContain("min-h-11 px-3 py-3 text-sm");
    expect(source("routes/auth.forgot.tsx")).toContain("min-h-11 min-w-0");
    expect(source("routes/onboarding.tsx")).toContain("min-h-11 min-w-11 px-2 py-3");
    for (const file of ["login", "auth.forgot", "favorites", "promo-codes", "help"]) {
      expect(source(`routes/${file}.tsx`)).not.toMatch(/text-\[(?:10|11)px\]/);
    }
    expect(source("routes/promo-codes.tsx")).toContain("inline-flex min-h-11");
    for (const file of ["search", "category.$id"]) {
      expect(source(`routes/${file}.tsx`)).not.toContain("<select");
      expect(source(`routes/${file}.tsx`)).toContain("<CustomerFilterPicker");
    }
    expect(source("routes/search.tsx")).toContain('useState(search.serviceId ?? "")');
    expect(source("routes/search.tsx")).toContain("onChange={setAddressId}");
    expect(source("routes/category.$id.tsx")).toContain('value: "myself"');
    expect(source("routes/category.$id.tsx")).toContain("onChange={setForWhom}");
  });
});
