import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { PrimaryButton } from "@/components/famio/ui";

export const Route = createFileRoute("/parent-guardian/flag")({
  component: ParentGuardianFlagRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
});

function ParentGuardianFlagRoute() {
  const { t } = useTranslation();
  const { token } = Route.useSearch();
  const flag = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("flag_parent_link_by_token", {
        p_flag_token: token,
      });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-pro-20 font-extrabold">{t("studentParentLink.flagPageTitle")}</h1>
      <p className="text-pro-14 text-muted-foreground">{t("studentParentLink.flagPageBody")}</p>
      {flag.isSuccess ? (
        <p className="text-pro-14 font-semibold text-success">{t("studentParentLink.flagSubmitted")}</p>
      ) : (
        <PrimaryButton
          className="h-11 w-full"
          disabled={!token || flag.isPending}
          onClick={() => void flag.mutate()}
        >
          {t("studentParentLink.flagConfirm")}
        </PrimaryButton>
      )}
      {flag.isError ? (
        <p className="text-pro-13 text-coral">{t("studentParentLink.flagError")}</p>
      ) : null}
    </div>
  );
}