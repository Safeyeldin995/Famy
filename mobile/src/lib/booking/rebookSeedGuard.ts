import { useCallback, useMemo, useRef } from "react";
import type { RebookSeedField } from "@shared/booking/rebookFormBootstrap";

function seededFieldsKey(seededFields: ReadonlySet<RebookSeedField> | null | undefined): string {
  if (!seededFields?.size) return "";
  return [...seededFields].sort().join("\0");
}

export function useRebookSeedGuard(seededFields: ReadonlySet<RebookSeedField> | null | undefined) {
  const touched = useRef(new Set<RebookSeedField>());
  const seededKey = seededFieldsKey(seededFields);
  const stableSeeded = useMemo(
    () => (seededKey ? seededFields : undefined),
    [seededKey, seededFields],
  );

  const guardDefault = useCallback(
    (field: RebookSeedField) => {
      if (!stableSeeded?.has(field)) return false;
      return !touched.current.has(field);
    },
    [stableSeeded],
  );

  const touch = useCallback((field: RebookSeedField) => {
    touched.current.add(field);
  }, []);

  return useMemo(() => ({ guardDefault, touch }), [guardDefault, touch]);
}
