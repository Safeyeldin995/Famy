/** Translate known display labels only. Persist the original settings value. */
export function customerAreaLabel(name: string, t: (key: string) => string): string {
  const keys: Record<string, string> = {
    "Sheikh Zayed": "customerAreas.sheikhZayed",
    "6th of October": "customerAreas.october",
    Maadi: "customerAreas.maadi",
  };
  return keys[name] ? t(keys[name]) : name;
}
