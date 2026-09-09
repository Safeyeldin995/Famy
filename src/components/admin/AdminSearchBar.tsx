import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

export function AdminSearchBar({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t("common.search", "Search")}
        className="focus-ring h-10 w-full rounded-lg border border-border/60 bg-surface py-2 ps-9 pe-3 text-sm font-medium"
      />
    </div>
  );
}
