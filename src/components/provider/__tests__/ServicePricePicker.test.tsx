import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import {
  ServicePricePicker,
  buildPriceOptions,
  hasSelectedServicePrices,
  isSavedPriceOutOfRange,
} from "../ServicePricePicker";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
describe("price choices", () => {
  it.each([
    [100, 400, 25],
    [100, 401, 50],
    [100, 1100, 50],
    [100, 1101, 100],
  ])("uses the range step for %s–%s", (min, max, step) => {
    const options = buildPriceOptions(min, max);
    expect(options[0]).toBe(min);
    expect(options.at(-1)).toBe(max);
    expect(options[1] - options[0]).toBe(step);
    expect(options.every((price) => price >= min && price <= max)).toBe(true);
    expect(new Set(options).size).toBe(options.length);
  });
  it("includes non-round endpoints and a single fixed price", () => {
    expect(buildPriceOptions(110, 171)).toEqual([110, 125, 150, 171]);
    expect(buildPriceOptions(300, 300)).toEqual([300]);
  });
  it("rounds interior values while preserving exact endpoints, including narrow ranges", () => {
    expect(buildPriceOptions(120, 600)).toEqual([120, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600]);
    expect(buildPriceOptions(120, 124)).toEqual([120, 124]);
    expect(buildPriceOptions(125, 150)).toEqual([125, 150]);
    expect(buildPriceOptions(125, 125)).toEqual([125]);
  });
  it("uses the stepper for absent limits and rejects reversed limits", () => {
    expect(buildPriceOptions(null, null)).toEqual([]);
    expect(buildPriceOptions(100, null)).toEqual([]);
    expect(buildPriceOptions(null, 500)).toEqual([]);
    expect(buildPriceOptions(500, 100)).toEqual([]);
  });
  it("selects chips without free input", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ServicePricePicker min={100} max={150} value={null} onChange={onChange} unitLabel="EGP" />,
    );
    expect(container.querySelector("input")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "125" }));
    expect(onChange).toHaveBeenCalledWith(125);
  });
  it("requires an explicit stepper choice, starting at 50", () => {
    const onChange = vi.fn();
    render(
      <ServicePricePicker min={null} max={null} value={null} onChange={onChange} unitLabel="EGP" />,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "pricePicker.decrease" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "pricePicker.increase" }));
    expect(onChange).toHaveBeenCalledWith(50);
  });
  it("clamps a one-sided limit", () => {
    const onChange = vi.fn();
    render(
      <ServicePricePicker min={null} max={125} value={100} onChange={onChange} unitLabel="EGP" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "pricePicker.increase" }));
    expect(onChange).toHaveBeenCalledWith(125);
  });
});
describe("onboarding Next gate", () => {
  const services = [
    { id: "clean", provider_pricing_allowed: true, minimum_price: 100, maximum_price: 200 },
    { id: "teach", provider_pricing_allowed: true, category: { slug: "tutoring" } },
    { id: "fixed", provider_pricing_allowed: false },
  ];
  it("requires each selected custom price to be present and in range", () => {
    expect(hasSelectedServicePrices(services, ["clean"], {})).toBe(false);
    expect(hasSelectedServicePrices(services, ["clean"], { clean: 99 })).toBe(false);
    expect(hasSelectedServicePrices(services, ["clean"], { clean: 201 })).toBe(false);
    expect(hasSelectedServicePrices(services, ["clean"], { clean: 100 })).toBe(true);
  });
  it("excludes tutoring, fixed prices and deselected services; waits for catalog", () => {
    expect(hasSelectedServicePrices(services, ["teach", "fixed"], {})).toBe(true);
    expect(hasSelectedServicePrices(services, [], {})).toBe(true);
    expect(hasSelectedServicePrices([], ["clean"], { clean: 100 })).toBe(false);
  });
});
describe("saved-price notice", () => {
  it.each([
    [50, true],
    [100, false],
    [200, false],
    [201, true],
    [null, false],
  ])("detects %s without modifying it", (price, expected) => {
    expect(isSavedPriceOutOfRange(price, 100, 200)).toBe(expected);
  });
  it("supports absent and one-sided limits", () => {
    expect(isSavedPriceOutOfRange(100, null, null)).toBe(false);
    expect(isSavedPriceOutOfRange(100, 150, null)).toBe(true);
    expect(isSavedPriceOutOfRange(100, null, 50)).toBe(true);
  });
});
