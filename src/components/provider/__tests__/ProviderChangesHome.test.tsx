import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/lib/i18n";
import { PendingHomeView, ProviderPendingHome } from "../ProviderPendingHome";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: i18n.getFixedT("ar"), i18n: { dir: () => "rtl" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to: string;
    params?: { item: string };
    search?: { step: number };
    children: ReactNode;
  }) => (
    <a
      href={`${params ? to.replace("$item", params.item) : to}${search ? `?step=${search.step}` : ""}`}
      {...props}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/lib/db/queries", () => ({ useAvatarUrl: () => ({ data: null }) }));
afterEach(cleanup);
const data = {
  hours: false,
  photo: false,
  about: false,
  personal: false,
  reference: false,
  babysitting: false,
  needsBabysitting: true,
  subjects: false,
  needsSubjects: true,
};
it("shows the reason and all ten links, and resubmits into the normal pending preview", async () => {
  render(<ProviderPendingHome preview changesRequested />);
  expect(screen.getByRole("heading", { name: "فريق فامي محتاج منك تعديل" })).toBeTruthy();
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(10);
  expect(links.slice(0, 3).map((link) => link.getAttribute("href"))).toEqual([
    "/pro/apply?step=1",
    "/pro/apply?step=2",
    "/pro/apply?step=3",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "ابعت طلبي تاني" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "ابعت طلبي تاني" })).toBeNull());
  expect(screen.getByText("مراجعة فريق فامي")).toBeTruthy();
});
it("disables resubmit for missing minimal fields with the apply-step-three hint", () => {
  const submit = vi.fn();
  render(
    <PendingHomeView
      fullName="Test"
      data={data}
      changes={{
        completion: { ok: true, complete: false, errors: { documents: "national_id_required" } },
        onSubmit: submit,
      }}
    />,
  );
  const button = screen.getByRole("button", { name: "ابعت طلبي تاني" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(screen.getByText(i18n.getFixedT("ar")("providerApply.missingIdentity"))).toBeTruthy();
  fireEvent.click(button);
  expect(submit).not.toHaveBeenCalled();
});
it("keeps the page and choices after a rejected resubmit, highlights matching rows and announces the hint", async () => {
  const submit = vi.fn().mockRejectedValue(
    Object.assign(new Error("submission_incomplete"), {
      completionErrors: { services: "provider_price_invalid" },
    }),
  );
  render(
    <PendingHomeView
      fullName="Test"
      data={data}
      changes={{ reason: "راجع السعر", completion: { ok: true, complete: true }, onSubmit: submit }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "ابعت طلبي تاني" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      i18n.getFixedT("ar")("providerApply.missingIdentity"),
    ),
  );
  expect(screen.getByRole("link", { name: /الخدمات والأسعار/ }).className).toContain(
    "border-destructive",
  );
  expect(screen.getByText("راجع السعر")).toBeTruthy();
  expect(screen.getAllByRole("link")).toHaveLength(10);
  expect(
    (screen.getByRole("button", { name: "ابعت طلبي تاني" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
