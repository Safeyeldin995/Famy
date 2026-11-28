import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/lib/i18n";
import { PendingHomeView, ProviderPendingHome } from "../ProviderPendingHome";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: i18n.getFixedT("ar"), i18n: { dir: () => "rtl" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => false,
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params: { item: string };
    children: ReactNode;
  }) => (
    <a href={to.replace("$item", params.item)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/db/queries", () => ({ useAvatarUrl: () => ({ data: "/signed-avatar-test.png" }) }));
afterEach(cleanup);

it("shows the review status and one «كمل ملفك» card ordered by impact", () => {
  render(<ProviderPendingHome preview />);
  expect(screen.getByRole("heading", { name: "أهلا يا منى" })).toBeTruthy();
  expect(screen.getByText("مراجعة فريق فامي").closest("a")).toBeNull();
  expect(screen.getByText("فاضلك 4 خطوات")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "كمل ملفك" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "ملفك مكتمل 30%" })).toBeTruthy();
  const links = screen.getAllByRole("link");
  // Done items (photo, hours, reference) collapse behind one toggle.
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "/pro/setup/subjects",
    "/pro/setup/babysitting",
    "/pro/setup/about",
    "/pro/setup/experience",
    "/pro/setup/education",
    "/pro/setup/certificates",
    "/pro/setup/personal",
  ]);
  // Only the items the approval already requires carry the tag.
  expect(screen.getAllByText("مطلوب")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "اللي خلصته (3)" })).toBeTruthy();
  expect(screen.getByText("جاري")).toBeTruthy();
});

it("uses the profile first name and signed photo", () => {
  render(
    <PendingHomeView
      fullName="  Sara Example  "
      avatarUrl="private-avatar-path"
      data={{
        hours: true,
        photo: true,
        about: true,
        personal: true,
        reference: true,
        babysitting: false,
        needsBabysitting: false,
        subjects: false,
        needsSubjects: false,
      }}
    />,
  );
  expect(screen.getByRole("heading", { name: "أهلا يا Sara" })).toBeTruthy();
  expect(screen.getByAltText("").getAttribute("src")).toBe("/signed-avatar-test.png");
  expect(screen.getByAltText("").getAttribute("aria-hidden")).toBe("true");
  expect(screen.queryByRole("img", { name: "Sara Example" })).toBeNull();
  expect(screen.getByRole("heading", { name: "طلبك كامل ✓" })).toBeTruthy();
  // The optional extras still show in «كمل ملفك» without the «مطلوب» tag.
  expect(screen.getByRole("heading", { name: "كمل ملفك" })).toBeTruthy();
  expect(screen.queryByText("مطلوب")).toBeNull();
  // The old "done/total" ring is gone; the card shows a percentage instead.
  expect(screen.queryByText(/^\d+\/\d+$/)).toBeNull();
  expect(screen.getByRole("img", { name: "ملفك مكتمل 71%" })).toBeTruthy();
  expect(
    screen.getAllByText("فريق فامي هيراجع طلبك وهيرد عليك خلال 24 ساعة، هيوصلك إشعار أول ما نخلص"),
  ).toHaveLength(2);
});
