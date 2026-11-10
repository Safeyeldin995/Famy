import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountDeletionPublic } from "../AccountDeletionPublic";
import { ACCOUNT_DELETE_INTENT } from "@/lib/web/webSurface";

vi.mock("@/components/site/SiteLayout", () => ({
  SiteLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SiteSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { returnObjects?: boolean }) => {
      if (key === "accountDeletion.deletedItems" && opts?.returnObjects) {
        return ["Profile photo"];
      }
      const copy: Record<string, string> = {
        "accountDeletion.title": "Delete account",
        "accountDeletion.intro": "Deletion intro",
        "accountDeletion.webPublicLead": "Sign in to finish",
        "accountDeletion.deletedTitle": "What we delete",
        "accountDeletion.keptTitle": "What we keep",
        "accountDeletion.keptBody": "Bookings stay anonymized",
        "accountDeletion.webSignIn": "Sign in to delete your account",
        "common.appName": "Famy",
        "site.nav.label": "Site",
        "site.nav.home": "Home",
        "site.nav.about": "About",
        "site.footer.help": "Help",
        "site.nav.contact": "Contact",
        "site.footer.tagline": "Tagline",
        "site.footer.company": "Company",
        "site.footer.legal": "Legal",
        "profile.terms": "Terms",
        "profile.privacy": "Privacy",
        "site.footer.deleteAccount": "Delete account",
        "site.footer.rights": "Rights",
        "site.download.comingSoon": "Coming soon on",
      };
      return copy[key] ?? key;
    },
  }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      children,
      to,
      search,
    }: {
      children: React.ReactNode;
      to: string;
      search?: { intent?: string };
    }) => (
      <a href={`${to}?intent=${search?.intent ?? ""}`}>{children}</a>
    ),
    useRouter: () => ({ invalidate: vi.fn() }),
  };
});

describe("AccountDeletionPublic", () => {
  it("shows deletion policy and login CTA for signed-out visitors", () => {
    render(<AccountDeletionPublic />);
    expect(screen.getByRole("heading", { level: 1, name: "Delete account" })).toBeTruthy();
    expect(screen.getByText("Deletion intro")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in to delete your account" }).getAttribute("href")).toBe(
      `/login?intent=${ACCOUNT_DELETE_INTENT}`,
    );
  });
});
