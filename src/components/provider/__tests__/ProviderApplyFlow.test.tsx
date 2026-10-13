import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProviderApplyFlow, applyStepReady, type ApplyDraft } from "../ProviderApplyFlow";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "ar", dir: () => "rtl" } }),
}));
afterEach(cleanup);
const services = [
  {
    id: "s",
    name_en: "Service",
    name_ar: "خدمة",
    provider_pricing_allowed: true,
    minimum_price: 100,
    maximum_price: 500,
  },
];
const draft: ApplyDraft = {
  name: "Synthetic Name",
  zones: ["z"],
  services: ["s"],
  prices: { s: 250 },
  front: true,
  back: true,
  agreed: true,
};
it("gates exactly the minimal three screens and keeps tutoring prices deferred", () => {
  expect(applyStepReady(1, { ...draft, name: " " }, services)).toBe(false);
  expect(applyStepReady(1, { ...draft, zones: [] }, services)).toBe(false);
  expect(applyStepReady(2, { ...draft, prices: { s: 99 } }, services)).toBe(false);
  expect(applyStepReady(2, { ...draft, services: [] }, services)).toBe(false);
  expect(
    applyStepReady(
      2,
      { ...draft, prices: {} },
      services.map((s) => ({ ...s, category: { slug: "tutoring" } })),
    ),
  ).toBe(true);
  for (const field of ["front", "back", "agreed"])
    expect(applyStepReady(3, { ...draft, [field]: false }, services)).toBe(false);
  expect(applyStepReady(3, draft, services)).toBe(true);
});
it("preserves name and selections across Back and failed saves", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <ProviderApplyFlow
      initial={draft}
      zones={[{ id: "z", name_en: "Zone", name_ar: "منطقة" }]}
      services={services}
      onSave={save}
      onCapture={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("providerApply.name"), {
    target: { value: "Updated draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "providerApply.next" }));
  await screen.findByRole("heading", { name: "providerApply.services" });
  fireEvent.click(screen.getByRole("button", { name: "common.back" }));
  expect((screen.getByLabelText("providerApply.name") as HTMLInputElement).value).toBe(
    "Updated draft",
  );
  save.mockRejectedValueOnce(new Error("Synthetic save failure"));
  fireEvent.click(screen.getByRole("button", { name: "providerApply.next" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("providerApply.saveError"),
  );
  expect((screen.getByLabelText("providerApply.name") as HTMLInputElement).value).toBe(
    "Updated draft",
  );
});

it("opens the requested application step with saved data and preserves earlier choices", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <ProviderApplyFlow
      initial={draft}
      initialStep={3}
      zones={[{ id: "z", name_en: "Zone", name_ar: "منطقة" }]}
      services={services}
      onSave={save}
      onCapture={vi.fn()}
    />,
  );
  expect(screen.getByRole("heading", { name: "providerApply.identity" })).toBeTruthy();
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "common.back" }));
  expect(screen.getByRole("heading", { name: "providerApply.services" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "common.back" }));
  expect((screen.getByLabelText("providerApply.name") as HTMLInputElement).value).toBe(draft.name);
  expect(save).not.toHaveBeenCalled();
});

it("reveals missing fields only after Continue and does not save an invalid draft", () => {
  const save = vi.fn();
  render(
    <ProviderApplyFlow
      initial={{ ...draft, name: "", zones: [] }}
      zones={[]}
      services={services}
      onSave={save}
      onCapture={vi.fn()}
    />,
  );
  expect(screen.queryByText("proRound2.nameRequired")).toBeNull();
  expect(screen.queryByText("proRound2.zonesRequired")).toBeNull();
  expect(screen.getByLabelText("providerApply.name").hasAttribute("aria-invalid")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "providerApply.next" }));
  expect(screen.getByLabelText("providerApply.name").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByLabelText("providerApply.name").getAttribute("aria-describedby")).toBe(
    "apply-name-error",
  );
  expect(screen.getByText("proRound2.nameRequired")).toBeTruthy();
  expect(screen.getByText("proRound2.zonesRequired")).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
});
it("keeps a failed ID upload beside the relevant card and never marks it captured", async () => {
  const save = vi.fn();
  const capture = vi.fn().mockRejectedValue(new Error("synthetic upload failure"));
  render(
    <ProviderApplyFlow
      initial={{ ...draft, back: false }}
      initialStep={3}
      zones={[]}
      services={services}
      onSave={save}
      onCapture={capture}
    />,
  );
  fireEvent.change(screen.getByLabelText("providerApply.back"), {
    target: { files: [new File(["test"], "id.png", { type: "image/png" })] },
  });
  expect((await screen.findByRole("alert")).textContent).toBe("proRound2.uploadError");
  fireEvent.click(screen.getByRole("button", { name: "providerApply.submit" }));
  expect(save).not.toHaveBeenCalled();
});

it.each([2, 3] as const)("does not show missing-field errors on first visit to step %s", (step) => {
  const save = vi.fn();
  render(
    <ProviderApplyFlow
      initial={{ ...draft, services: [], front: false, back: false, agreed: false }}
      initialStep={step}
      zones={[]}
      services={services}
      onSave={save}
      onCapture={vi.fn()}
    />,
  );
  const keys =
    step === 2 ? ["servicesRequired"] : ["frontRequired", "backRequired", "agreementRequired"];
  for (const key of keys) expect(screen.queryByText(`proRound2.${key}`)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: step === 2 ? "providerApply.next" : "providerApply.submit",
    }),
  );
  for (const key of keys) expect(screen.getByText(`proRound2.${key}`)).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
});
it("resets attempted guidance when advancing to the next step", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <ProviderApplyFlow
      initial={{ ...draft, name: "", services: [] }}
      zones={[{ id: "z", name_ar: "منطقة", name_en: "Zone" }]}
      services={services}
      onSave={save}
      onCapture={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "providerApply.next" }));
  fireEvent.change(screen.getByLabelText("providerApply.name"), {
    target: { value: "Updated name" },
  });
  fireEvent.click(screen.getByRole("button", { name: "providerApply.next" }));
  await screen.findByRole("heading", { name: "providerApply.services" });
  expect(screen.queryByText("proRound2.servicesRequired")).toBeNull();
});
