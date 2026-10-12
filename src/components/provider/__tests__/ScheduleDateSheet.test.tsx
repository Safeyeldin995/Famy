import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/lib/i18n";
import { ScheduleDateSheet } from "../ScheduleDateSheet";

const language = vi.hoisted(() => ({ value: "en" }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: i18n.getFixedT(language.value),
    i18n: { dir: () => (language.value === "ar" ? "rtl" : "ltr") },
  }),
}));
vi.mock("vaul", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Drawer: { Root: Wrapper, Portal: Wrapper, Overlay: Wrapper, Content: Wrapper, Title: Wrapper },
  };
});
vi.mock("@/components/famio/BottomSheetSelect", () => ({
  BottomSheetSelect: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 3, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each(["en", "ar"])(
  "defaults to today and saves the start as the untouched end in %s",
  (lang) => {
    language.value = lang;
    const t = i18n.getFixedT(lang);
    const onSave = vi.fn();
    render(
      <ScheduleDateSheet range busy={false} error={false} onClose={() => {}} onSave={onSave} />,
    );
    const start = within(screen.getByRole("group", { name: t("pro.schedule.vacationStart") }));
    const end = within(screen.getByRole("group", { name: t("pro.schedule.vacationEnd") }));
    expect((start.getByLabelText(t("providerSetup.day")) as HTMLSelectElement).value).toBe("3");
    expect((start.getByLabelText(t("providerSetup.month")) as HTMLSelectElement).value).toBe("11");
    expect(start.getByLabelText(t("providerSetup.year")).textContent).toBe("20262027");
    expect(start.queryByRole("option", { name: "31" })).toBeNull();
    fireEvent.change(start.getByLabelText(t("providerSetup.day")), { target: { value: "5" } });
    expect((end.getByLabelText(t("providerSetup.day")) as HTMLSelectElement).value).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: t("pro.schedule.add") }));
    expect(onSave).toHaveBeenCalledWith("2026-11-05", "2026-11-05", "");
  },
);
it.each(["en", "ar"])("blocks past starts and reversed ends with inline copy in %s", (lang) => {
  language.value = lang;
  const t = i18n.getFixedT(lang);
  const onSave = vi.fn();
  render(<ScheduleDateSheet range busy={false} error={false} onClose={() => {}} onSave={onSave} />);
  const start = within(screen.getByRole("group", { name: t("pro.schedule.vacationStart") }));
  const end = within(screen.getByRole("group", { name: t("pro.schedule.vacationEnd") }));
  fireEvent.change(start.getByLabelText(t("providerSetup.day")), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: t("pro.schedule.add") }));
  expect(screen.getByRole("alert").textContent).toBe(t("pro.schedule.startPast"));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(start.getByLabelText(t("providerSetup.day")), { target: { value: "5" } });
  fireEvent.change(end.getByLabelText(t("providerSetup.day")), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: t("pro.schedule.add") }));
  expect(screen.getByRole("alert").textContent).toBe(t("pro.schedule.endBeforeStart"));
  expect(onSave).not.toHaveBeenCalled();
});
