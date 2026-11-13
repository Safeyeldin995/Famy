import { useCallback, useRef } from "react";
import type { RebookSeedField } from "@shared/booking/rebookFormBootstrap";

export function useRebookSeedGuard(seededFields: ReadonlySet<RebookSeedField> | null | undefined) {
  const touched = useRef(new Set<RebookSeedField>());

  const guardDefault = useCallback(
    (field: RebookSeedField) => {
      if (!seededFields?.has(field)) return false;
      return !touched.current.has(field);
    },
    [seededFields],
  );

  const touch = useCallback((field: RebookSeedField) => {
    touched.current.add(field);
  }, []);

  return { guardDefault, touch };
}
