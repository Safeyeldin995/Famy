import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StickyCta } from "./StickyCta";
import "./providerApply.css";
export function SetupScreen({
  title,
  hint,
  children,
  onBack,
  onSave,
  disabled,
  busy,
  error,
  saveLabel,
  missing,
}: {
  title: string;
  hint: string;
  children: ReactNode;
  onBack: () => void;
  onSave: () => void;
  disabled?: boolean;
  busy?: boolean;
  error?: string;
  saveLabel?: string;
  missing?: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <main className="apply-ui apply-screen" dir={i18n.dir()}>
      <header className="apply-header">
        <button type="button" className="apply-back" onClick={onBack} aria-label={t("common.back")}>
          <ArrowRight size={20} />
        </button>
      </header>
      <div className="apply-content">
        <h1 className="apply-title">{title}</h1>
        <p className="apply-subtitle">{hint}</p>
        {children}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <StickyCta disabled={disabled || busy} onClick={onSave} hint={missing}>
        {busy ? t("providerApply.saving") : (saveLabel ?? t("providerSetup.save"))}
      </StickyCta>
    </main>
  );
}
