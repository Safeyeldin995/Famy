import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

export function OnlineWebAccountMenu() {
  const { t } = useTranslation();
  const { user, loading, isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();

  const profileQ = useQuery({
    enabled: !!user?.id,
    queryKey: ["online-web-profile-name", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.full_name?.trim() || null;
    },
  });

  if (loading || !isAuthenticated || !user) return null;

  const label = profileQ.data || user.phone || t("onlineWeb.account.signedIn");

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    setOpen(false);
    void nav({ to: ONLINE_WEB_ROUTE_IDS.home, replace: true });
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="focus-ring inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full border border-border bg-white px-3 py-1.5 text-pro-12 font-bold text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </button>
      {open ? (
        <div className="absolute end-0 top-full z-50 mt-1 min-w-[10rem] rounded-2xl border border-border bg-white py-1 shadow-lg">
          <button
            type="button"
            className="focus-ring flex w-full items-center gap-2 px-4 py-2 text-pro-13 font-semibold text-coral hover:bg-surface-2"
            onClick={() => void signOut()}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t("onlineWeb.account.signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}