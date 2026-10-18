import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type GateState =
  | { step: "loading" }
  | { step: "ok" }
  | { step: "challenge"; factorId: string }
  | { step: "enroll"; factorId: string; qr: string; secret: string }
  | { step: "error" };

/**
 * Admin access requires a second factor (TOTP authenticator app). The database
 * enforces the same rule: has_role(auth.uid(), 'admin') is false unless the
 * session JWT is aal2, so this screen is the way in, not the only guard.
 */
export function AdminMfaGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<GateState>({ step: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    try {
      const { data: aal, error: aalError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      if (aal.currentLevel === "aal2") {
        setState({ step: "ok" });
        return;
      }
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const verified = factors.totp.find((f) => f.status === "verified");
      if (verified) {
        setState({ step: "challenge", factorId: verified.id });
        return;
      }
      // Drop half-finished enrolments so a fresh QR code can be issued.
      for (const f of factors.all.filter((f) => f.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Famy admin ${new Date().toISOString().slice(0, 10)}`,
      });
      if (enrollError) throw enrollError;
      setState({
        step: "enroll",
        factorId: enrolled.id,
        qr: enrolled.totp.qr_code,
        secret: enrolled.totp.secret,
      });
    } catch {
      setState({ step: "error" });
    }
  }, []);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const verify = async () => {
    if (state.step !== "challenge" && state.step !== "enroll") return;
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: state.factorId,
      code: clean,
    });
    setBusy(false);
    if (verifyError) {
      setError(t("adminMfa.wrongCode"));
      setCode("");
      return;
    }
    setCode("");
    setState({ step: "ok" });
  };

  if (state.step === "ok") return <>{children}</>;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#FEFAFC] px-5 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-border/60 bg-white p-6 shadow-sm">
        <ShieldCheck className="mx-auto h-10 w-10 text-brand" aria-hidden="true" />
        <h1 className="mt-3 text-center text-xl font-extrabold">{t("adminMfa.title")}</h1>

        {state.step === "loading" && (
          <div className="mt-6 grid place-items-center" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
            <span className="sr-only">{t("common.loading")}</span>
          </div>
        )}

        {state.step === "error" && (
          <div className="mt-4 text-center">
            <p className="text-sm text-muted-foreground">{t("adminMfa.loadError")}</p>
            <button
              type="button"
              onClick={() => {
                setState({ step: "loading" });
                void resolve();
              }}
              className="focus-ring mt-4 min-h-11 rounded-xl bg-brand px-5 text-sm font-bold text-brand-foreground"
            >
              {t("adminMfa.retry")}
            </button>
          </div>
        )}

        {state.step === "enroll" && (
          <div className="mt-3 space-y-3 text-center">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("adminMfa.enrollBody")}
            </p>
            <img
              src={state.qr}
              alt={t("adminMfa.qrAlt")}
              className="mx-auto h-48 w-48 rounded-xl border border-border bg-white p-2"
            />
            <p className="text-xs text-muted-foreground">{t("adminMfa.manualKey")}</p>
            <code
              dir="ltr"
              className="block select-all break-all rounded-xl bg-surface-2 px-3 py-2 text-sm font-bold"
            >
              {state.secret}
            </code>
          </div>
        )}

        {state.step === "challenge" && (
          <p className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">
            {t("adminMfa.challengeBody")}
          </p>
        )}

        {(state.step === "enroll" || state.step === "challenge") && (
          <div className="mt-5">
            <label htmlFor="admin-mfa-code" className="block text-sm font-bold">
              {t("adminMfa.codeLabel")}
            </label>
            <input
              id="admin-mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void verify();
              }}
              className="mt-2 h-14 w-full rounded-2xl border border-border bg-surface px-4 text-center text-2xl font-extrabold tracking-[0.4em] outline-none focus:border-brand"
            />
            {error && <p className="mt-2 text-sm font-semibold text-coral">{error}</p>}
            <button
              type="button"
              onClick={() => void verify()}
              disabled={code.length !== 6 || busy}
              className="focus-ring mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl bg-brand text-base font-extrabold text-brand-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : t("adminMfa.confirm")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
