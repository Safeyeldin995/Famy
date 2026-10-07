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

it("renders all seven editable preview tasks, progress, next and waiting states", () => {
  render(<ProviderPendingHome preview />);
  expect(screen.getByRole("heading", { name: "أهلا يا منى" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "فاضلك 4 خطوات" })).toBeTruthy();
  expect(screen.getByText("4/9")).toBeTruthy();
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(7);
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "/pro/setup/photo",
    "/pro/setup/about",
    "/pro/setup/babysitting",
    "/pro/setup/subjects",
    "/pro/setup/reference",
    "/pro/setup/personal",
    "/pro/setup/hours",
  ]);
  expect(links[0].classList.contains("apply-done")).toBe(true);
  expect(links[4].classList.contains("apply-done")).toBe(true);
  expect(screen.getByText("ابدأ").closest("a")).toBe(links[1]);
  expect(screen.getAllByText("دقيقة")).toHaveLength(3);
  expect(screen.getByText("مراجعة فريق فامي").closest("a")).toBeNull();
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
  expect(screen.getByRole("img", { name: "Sara Example" }).getAttribute("src")).toBe(
    "/signed-avatar-test.png",
  );
  expect(screen.queryByText("ابدأ")).toBeNull();
  expect(screen.getByText("فريق فامي بيراجع طلبك وهنبلغك أول ما نوافق")).toBeTruthy();
});
