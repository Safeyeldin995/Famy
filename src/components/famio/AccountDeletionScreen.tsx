import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell, PrimaryButton, SecondaryButton } from "@/components/famio/ui";
import { CustomerPageHeader } from "@/components/famio/CustomerPageHeader";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAccountDeletionCheck,
  requestAccountDeletion,
} from "@/lib/account/deleteAccountActions";
import type { AccountDeletionCheck } from "@/lib/account/accountDeletion.types";
import { currentLang } from "@/lib/i18n";

export function AccountDeletionScreen({ backTo }: { backTo: string }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { reset } = useApp();
  const [check, setCheck] = useState<AccountDeletionCheck | null>(null);
  const [loadingCheck, setLoadingCheck] = useState(true);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const confirmWord = t("accountDeletion.confirmWord");
  const confirmMatches = useMemo(
    () => confirmText.trim() === confirmWord,
    [confirmText, confirmWord],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingCheck(true);
      try {
        const result = await fetchAccountDeletionCheck();
        if (!cancelled) setCheck(result);
      } catch {
        if (!cancelled) setCheck({ ok: false, reason: "not_authenticated" });
      } finally {
        if (!cancelled) setLoadingCheck(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const blockedReason = !check?.ok ? check?.reason : undefined;

  const handleDelete = async () => {
    if (!confirmMatches || !check?.ok) return;
    setBusy(true);
    setErrorKey(null);
    const result = await requestAccountDeletion();
    if (!result.ok) {
      setErrorKey(`accountDeletion.errors.${result.error}`);
      setBusy(false);
      return;
    }
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    reset();
    nav({ to: "/login", replace: true });
  };

  return (
    <AppShell>
      <CustomerPageHeader title={t("accountDeletion.title")} backTo={backTo} />
      <div className="space-y-6 px-5 pb-8 pt-4">
        <p className="text-pro-14 font-medium text-muted-foreground">{t("accountDeletion.intro")}</p>

        <section className="rounded-2xl border border-border/60 bg-white p-4">
          <h2 className="text-pro-14 font-extrabold text-foreground">
            {t("accountDeletion.deletedTitle")}
          </h2>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-pro-13 font-medium text-muted-foreground">
            {(t("accountDeletion.deletedItems", { returnObjects: true }) as string[]).map(
              (item) => (
                <li key={item}>{item}</li>
              ),
            )}
          </ul>
        </section>

        <section className="rounded-2xl border border-border/60 bg-white p-4">
          <h2 className="text-pro-14 font-extrabold text-foreground">
            {t("accountDeletion.keptTitle")}
          </h2>
          <p className="mt-2 text-pro-13 font-medium text-muted-foreground">
            {t("accountDeletion.keptBody")}
          </p>
        </section>

        {loadingCheck ? (
          <p className="text-pro-13 font-semibold text-muted-foreground">
            {t("accountDeletion.checking")}
          </p>
        ) : null}

        {!loadingCheck && blockedReason === "active_bookings" ? (
          <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-pro-13 font-semibold text-destructive">
            {t("accountDeletion.blockedActiveBookings")}
          </p>
        ) : null}

        {!loadingCheck && blockedReason === "admin" ? (
          <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-pro-13 font-semibold text-destructive">
            {t("accountDeletion.blockedAdmin")}
          </p>
        ) : null}

        {!loadingCheck && blockedReason === "not_authenticated" ? (
          <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-pro-13 font-semibold text-destructive">
            {t("accountDeletion.errors.unauthorized")}
          </p>
        ) : null}

        {!loadingCheck && check?.ok ? (
          <div className="space-y-3">
            <label className="block text-pro-13 font-bold text-foreground" htmlFor="delete-confirm">
              {t("accountDeletion.typeConfirm", { word: confirmWord })}
            </label>
            <input
              id="delete-confirm"
              dir={currentLang() === "ar" ? "rtl" : "ltr"}
              className="focus-ring w-full rounded-2xl border border-border/70 bg-white px-4 py-3 text-pro-14 font-semibold"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              aria-describedby="delete-confirm-hint"
            />
            <p id="delete-confirm-hint" className="text-pro-12 font-medium text-muted-foreground">
              {t("accountDeletion.confirmHint")}
            </p>
          </div>
        ) : null}

        {errorKey ? (
          <p role="alert" className="text-pro-13 font-semibold text-destructive">
            {t(errorKey)}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 pt-2">
          <PrimaryButton
            className="!bg-destructive hover:!bg-destructive/90"
            disabled={!check?.ok || !confirmMatches || busy}
            onClick={() => void handleDelete()}
          >
            {busy ? t("accountDeletion.deleting") : t("accountDeletion.deleteButton")}
          </PrimaryButton>
          <SecondaryButton onClick={() => nav({ to: backTo })} disabled={busy}>
            {t("common.cancel")}
          </SecondaryButton>
        </div>
      </div>
    </AppShell>
  );
}
