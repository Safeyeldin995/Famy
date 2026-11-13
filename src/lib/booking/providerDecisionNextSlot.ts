import { formatProviderNextSlotLine, type NextBookableSlot } from "./providerNextSlot";

type Copy = (key: string, options?: Record<string, unknown>) => string;

export function providerDecisionNextSlotLine(input: {
  slot: NextBookableSlot | null | undefined;
  settingsReady: boolean;
  slotsReady: boolean;
  settingsErrored: boolean;
  slotsErrored: boolean;
  language: string;
  cairoTime: boolean;
  t: Copy;
}): string | null {
  if (input.settingsErrored || input.slotsErrored) return null;
  if (!input.settingsReady || !input.slotsReady || !input.slot) return null;
  return input.t("providerPage.nextSlot", {
    when: formatProviderNextSlotLine(input.slot, input.language, input.cairoTime),
  });
}
