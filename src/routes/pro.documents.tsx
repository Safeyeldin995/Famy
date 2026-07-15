import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, Card, Badge, EmptyState } from "@/components/famio/ui";
import { useMyProvider, useProviderDocuments, useUploadDocument, getSignedDocumentUrl } from "@/lib/db/provider-queries";
import { Upload, FileText, Eye } from "lucide-react";

export const Route = createFileRoute("/pro/documents")({ component: DocumentsPage });

const DOC_TYPES = ["id_card", "passport", "criminal_record", "certificate", "other"] as const;

function statusTone(s: string) {
  if (s === "approved") return "mint" as const;
  if (s === "rejected") return "coral" as const;
  return "muted" as const;
}

function DocumentsPage() {
  const { t } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as any;
  const docsQ = useProviderDocuments(provider?.id);
  const upload = useUploadDocument();
  const [type, setType] = useState<string>("id_card");
  const [err, setErr] = useState("");

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr("");
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !provider) return;
    if (file.size > 10 * 1024 * 1024) { setErr(t("pro.documents.fileTooLarge")); return; }
    try {
      await upload.mutateAsync({ providerId: provider.id, type, file });
    } catch (e: any) {
      setErr(e?.message ?? t("pro.documents.uploadFailed"));
    }
  };

  const open = async (path: string) => {
    try {
      const url = await getSignedDocumentUrl(path);
      window.open(url, "_blank");
    } catch {}
  };

  return (
    <ProviderShell hideNav>
      <TopBar back={{ to: "/pro/profile" }} title={t("pro.documents.title")} />
      <div className="space-y-5 px-5 pb-10">
        <Card className="p-4">
          <div className="text-sm font-bold">{t("pro.documents.uploadDocument")}</div>
          <div className="mt-1 text-xs text-muted-foreground">{t("pro.documents.accepted")}</div>
          <div className="mt-3 space-y-2">
            <label className="block">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("pro.documents.type")}</div>
              <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm">
                {DOC_TYPES.map((d) => <option key={d} value={d}>{t(`pro.documents.types.${d}`)}</option>)}
              </select>
            </label>
            <label className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-navy/30 bg-navy/5 text-sm font-bold text-navy active:scale-[0.98]">
              <Upload className="h-4 w-4" /> {upload.isPending ? t("pro.documents.uploading") : t("pro.documents.chooseFile")}
              <input type="file" accept="image/*,application/pdf" onChange={handleFile} disabled={upload.isPending} className="hidden" />
            </label>
            {err && <div className="text-xs font-semibold text-coral">{err}</div>}
            {upload.isSuccess && !err && <div className="text-xs font-semibold text-success">{t("pro.documents.uploaded")}</div>}
          </div>
        </Card>

        <div>
          <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("pro.documents.myDocs")}</h2>
          {docsQ.isLoading ? (
            <div className="h-20 animate-pulse rounded-3xl bg-surface" />
          ) : (docsQ.data ?? []).length === 0 ? (
            <EmptyState emoji="📄" title={t("pro.documents.noDocs")} body={t("pro.documents.noDocsBody")} />
          ) : (
            <Card className="divide-y divide-border">
              {docsQ.data!.map((d: any) => (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-navy/10 text-navy"><FileText className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold">{String(t(`pro.documents.types.${d.type}`, { defaultValue: d.type }))}</div>
                    <div className="text-[11px] text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</div>
                  </div>
                  <Badge tone={statusTone(d.status)}>{String(t(`pro.documents.status.${d.status}`, { defaultValue: d.status }))}</Badge>
                  <button onClick={() => open(d.storage_path)} className="ms-1 grid h-9 w-9 place-items-center rounded-xl bg-surface-2"><Eye className="h-4 w-4" /></button>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </ProviderShell>
  );
}
