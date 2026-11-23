import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AdminSearchBar } from "@/components/admin/AdminSearchBar";
import { useAdminGlobalSearch } from "@/lib/db/admin-daily-ops-queries";
import { bookingCode } from "@/components/admin/operations";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";

export function AdminGlobalSearch() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(query, 300);
  const q = useAdminGlobalSearch(debounced, open);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const data = q.data;
  const hasResults =
    data &&
    (data.customers.items.length > 0 ||
      data.providers.items.length > 0 ||
      data.bookings.items.length > 0);

  return (
    <div ref={wrapRef} className="relative hidden w-full max-w-md lg:block">
      <AdminSearchBar
        value={query}
        onChange={(v) => {
          setQuery(v);
          setOpen(true);
        }}
        placeholder={t("admin.globalSearch.placeholder")}
        className="w-full"
      />
      {open && debounced.trim().length >= 2 ? (
        <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-[min(24rem,60vh)] overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-lg">
          {q.isLoading ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : q.isError ? (
            <p className="px-2 py-3 text-sm text-destructive">{t("admin.globalSearch.error")}</p>
          ) : !hasResults ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {t("admin.globalSearch.empty")}
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              {data!.customers.items.length > 0 ? (
                <SearchGroup title={t("admin.globalSearch.customers")}>
                  {data!.customers.items.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="flex w-full flex-col rounded-lg px-2 py-2 text-start hover:bg-muted"
                      onClick={() => {
                        setOpen(false);
                        void nav({ to: "/admin/customer/$id", params: { id: c.id } });
                      }}
                    >
                      <span className="font-semibold">{c.full_name ?? "—"}</span>
                      {c.phone ? (
                        <span dir="ltr" className="text-xs text-muted-foreground">
                          {c.phone}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </SearchGroup>
              ) : null}
              {data!.providers.items.length > 0 ? (
                <SearchGroup title={t("admin.globalSearch.providers")}>
                  {data!.providers.items.map((p) => (
                    <button
                      key={p.provider_id}
                      type="button"
                      className="flex w-full flex-col rounded-lg px-2 py-2 text-start hover:bg-muted"
                      onClick={() => {
                        setOpen(false);
                        void nav({ to: "/admin/provider/$id", params: { id: p.provider_id } });
                      }}
                    >
                      <span className="font-semibold">{p.full_name ?? "—"}</span>
                      {p.phone ? (
                        <span dir="ltr" className="text-xs text-muted-foreground">
                          {p.phone}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </SearchGroup>
              ) : null}
              {data!.bookings.items.length > 0 ? (
                <SearchGroup title={t("admin.globalSearch.bookings")}>
                  {data!.bookings.items.map((b) => (
                    <Link
                      key={b.id}
                      to="/admin/bookings"
                      search={{ booking: b.id }}
                      className="flex w-full flex-col rounded-lg px-2 py-2 hover:bg-muted"
                      onClick={() => setOpen(false)}
                    >
                      <span className="font-semibold">
                        <bdi dir="ltr">{bookingCode(b.id)}</bdi> · {b.status}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {b.customer_name ?? "—"} → {b.provider_name ?? "—"}
                      </span>
                    </Link>
                  ))}
                </SearchGroup>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SearchGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-2 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="divide-y divide-border/40">{children}</ul>
    </div>
  );
}

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
