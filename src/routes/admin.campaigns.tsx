import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Megaphone, Send, X } from "lucide-react";
import {
  useAdminCampaigns, useCreateCampaign, useActivateCampaign, useCancelCampaign,
  usePreviewCampaignAudience, useAdminCampaignDeliveryCount,
  type CampaignTarget,
} from "@/lib/db/admin-queries";

export const Route = createFileRoute("/admin/campaigns")({ component: AdminCampaigns });

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-amber-100 text-amber-700",
  sending: "bg-amber-100 text-amber-700",
  sent: "bg-mint/20 text-success",
  cancelled: "bg-coral/10 text-coral",
};

function toDatetimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CampaignForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const create = useCreateCampaign();
  const preview = usePreviewCampaignAudience();
  const [titleEn, setTitleEn] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [bodyAr, setBodyAr] = useState("");
  const [target, setTarget] = useState<CampaignTarget>("all");
  const [channelPush, setChannelPush] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState(toDatetimeLocal());

  const valid = titleEn.trim() && titleAr.trim() && bodyEn.trim() && bodyAr.trim();

  const handlePreview = () => {
    preview.mutate(target, { onError: (e: any) => toast.error(e?.message ?? t("admin.campaigns.audienceError")) });
  };

  const handleCreate = () => {
    if (!valid) { toast.error(t("admin.campaigns.fillBothLanguages")); return; }
    create.mutate(
      {
        title_en: titleEn.trim(), title_ar: titleAr.trim(),
        body_en: bodyEn.trim(), body_ar: bodyAr.trim(),
        target, channel_push: channelPush,
        scheduled_for: scheduled ? new Date(scheduledFor).toISOString() : null,
      },
      {
        onSuccess: () => {
          setTitleEn(""); setTitleAr(""); setBodyEn(""); setBodyAr("");
          onCreated();
        },
        onError: (e: any) => toast.error(e?.message ?? t("admin.campaigns.createError")),
      },
    );
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
      <h2 className="text-sm font-extrabold">{t("admin.campaigns.newCampaign")}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("admin.campaigns.draftsNote")}</p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input dir="ltr" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} placeholder={t("admin.campaigns.titleEnPlaceholder")}
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm" />
        <input value={titleAr} onChange={(e) => setTitleAr(e.target.value)} placeholder={t("admin.campaigns.titleArPlaceholder")} dir="rtl"
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm" />
        <textarea dir="ltr" value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} rows={3} placeholder={t("admin.campaigns.bodyEnPlaceholder")}
          className="resize-none rounded-xl border border-border bg-surface p-2 text-sm sm:col-span-1" />
        <textarea value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} rows={3} dir="rtl" placeholder={t("admin.campaigns.bodyArPlaceholder")}
          className="resize-none rounded-xl border border-border bg-surface p-2 text-sm sm:col-span-1" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select value={target} onChange={(e) => setTarget(e.target.value as CampaignTarget)}
          className="focus-ring h-9 rounded-lg border border-border bg-surface px-2 text-xs font-semibold">
          <option value="all">{t("admin.campaigns.targetAll")}</option>
          <option value="customers">{t("admin.customers.title")}</option>
          <option value="providers">{t("admin.layout.nav.providers")}</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs font-semibold">
          <input type="checkbox" checked={channelPush} onChange={(e) => setChannelPush(e.target.checked)} />
          {t("admin.campaigns.alsoSendPush")}
        </label>
        <label className="flex items-center gap-1.5 text-xs font-semibold">
          <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} />
          {t("admin.campaigns.scheduleForLater")}
        </label>
        {scheduled && (
          <input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-xs" />
        )}
        <button onClick={handlePreview} disabled={preview.isPending}
          className="focus-ring ms-auto rounded-lg border border-border px-3 py-1.5 text-xs font-bold disabled:opacity-50">
          {preview.isPending ? t("admin.campaigns.counting") : t("admin.campaigns.previewAudience")}
        </button>
      </div>
      {preview.data !== undefined && preview.isSuccess && (
        <p className="mt-2 text-xs text-muted-foreground">{t("admin.campaigns.estimatedRecipients")} <span className="font-bold text-foreground">{preview.data}</span></p>
      )}

      <button onClick={handleCreate} disabled={create.isPending || !valid}
        className="focus-ring mt-4 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-navy-foreground disabled:opacity-50">
        {create.isPending ? t("admin.cancellationReasons.saving") : t("admin.campaigns.saveDraft")}
      </button>
    </div>
  );
}

function CampaignRow({ c }: { c: any }) {
  const { t } = useTranslation();
  const activate = useActivateCampaign();
  const cancel = useCancelCampaign();
  const deliveryQ = useAdminCampaignDeliveryCount(c.status === "sent" ? c.id : undefined);

  return (
    <li className="rounded-xl border border-border/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{c.title_en}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_TONE[c.status] ?? "bg-muted text-muted-foreground"}`}>{c.status}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{c.body_en}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t("admin.campaigns.target")}: {c.target} · {t("admin.campaigns.push")}: {c.channel_push ? t("admin.campaigns.yes") : t("admin.campaigns.no")}
            {c.scheduled_for && ` · ${t("admin.campaigns.scheduled")}: ${new Date(c.scheduled_for).toLocaleString()}`}
            {c.status === "sent" && ` · ${t("admin.campaigns.delivered")}: ${deliveryQ.data ?? c.recipient_count ?? "…"}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {c.status === "draft" && (
            <button
              onClick={() => activate.mutate(c.id, { onError: (e: any) => toast.error(e?.message ?? t("admin.campaigns.activateError")) })}
              disabled={activate.isPending}
              className="focus-ring inline-flex items-center gap-1 rounded-lg bg-navy px-3 py-1.5 text-[11px] font-bold text-navy-foreground disabled:opacity-50"
            >
              <Send className="h-3 w-3" /> {t("admin.campaigns.activate")}
            </button>
          )}
          {(c.status === "draft" || c.status === "scheduled") && (
            <button
              onClick={() => cancel.mutate(c.id, { onError: (e: any) => toast.error(e?.message ?? t("admin.campaigns.cancelError")) })}
              disabled={cancel.isPending}
              className="focus-ring inline-flex items-center gap-1 rounded-lg border border-coral px-3 py-1.5 text-[11px] font-bold text-coral disabled:opacity-50"
            >
              <X className="h-3 w-3" /> {t("common.cancel")}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function AdminCampaigns() {
  const { t } = useTranslation();
  const q = useAdminCampaigns();

  return (
    <div className="space-y-4 px-5 py-5">
      <div className="flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-navy" />
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("admin.layout.nav.campaigns")}</h1>
      </div>

      <CampaignForm onCreated={() => q.refetch()} />

      <div className="rounded-2xl border border-border/60 bg-surface p-5 shadow-card">
        <h2 className="text-sm font-extrabold">{t("admin.layout.nav.campaigns")}</h2>
        {q.isLoading ? (
          <div className="mt-3 h-16 animate-pulse rounded-xl bg-muted" />
        ) : q.isError ? (
          <p className="mt-3 text-sm text-coral">{t("admin.campaigns.loadError")}</p>
        ) : (q.data ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("admin.campaigns.noCampaigns")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {q.data!.map((c: any) => <CampaignRow key={c.id} c={c} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
