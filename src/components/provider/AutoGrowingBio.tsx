import { useLayoutEffect, useRef } from "react";

export function AutoGrowingBio({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.max(112, field.scrollHeight)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="apply-input min-h-28 resize-none overflow-hidden py-3"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
