/**
 * Shared payment status card used on customer + provider + admin booking views.
 * Renders method/status, InstaPay instructions + proof upload (customer only when pending_review),
 * and confirm/reject actions (provider on booking + admin).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useBookingPayment,
  useUploadPaymentProof,
  useCapturePayment,
  useRejectPayment,
  useInstapayReceiver,
  getSignedProofUrl,
} from "@/lib/db/payment-queries";
import { Card, Badge } from "@/components/famio/ui";
import { formatEGP } from "@/lib/utils";
import { Banknote, Upload, Check, X, Eye, Copy, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";

export type ViewerRole = "customer" | "provider" | "admin";

function statusTone(s: string) {
  if (s === "captured") return "mint" as const;
  if (s === "rejected") return "coral" as const;
  return "muted" as const;
}

export function PaymentBlock({
  bookingId,
  viewer,
}: {
  bookingId: string;
  viewer: ViewerRole;
}) {
  const q = useBookingPayment(bookingId);
  const receiverQ = useInstapayReceiver();
  const upload = useUploadPaymentProof();
  const capture = useCapturePayment();
  const reject = useRejectPayment();
  const { t } = useTranslation();
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  if (q.isLoading) return <Card className="h-24 animate-pulse p-4"><span /></Card>;
  const p = q.data as any;
  if (!p) {
    return (
      <Card className="p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("payment.title")}</div>
        <div className="mt-1 text-sm text-muted-foreground">{t("payment.noneRecorded")}</div>
      </Card>
    );
  }

  const isCash = p.method === "cash";
  const isInstapay = p.method === "instapay";
  const canConfirm = viewer === "admin" || viewer === "provider";
  const canUpload = viewer === "customer" && isInstapay && p.status === "pending_review";

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error(t("payment.fileTooLarge")); return; }
    try {
      await upload.mutateAsync({ paymentId: p.id, bookingId, file });
      toast.success(t("payment.receiptUploaded"));
    } catch (e: any) {
      toast.error(e?.message ?? t("payment.uploadFailed"));
    }
  };

  const openProof = async () => {
    if (!p.proof_path) return;
    try {
      const url = await getSignedProofUrl(p.proof_path);
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e?.message ?? t("payment.cannotOpenReceipt"));
    }
  };

  const onCapture = async () => {
    try {
      await capture.mutateAsync({ paymentId: p.id, bookingId });
      toast.success(t("payment.markedReceived"));
    } catch (e: any) { toast.error(e?.message ?? t("payment.actionFailed")); }
  };

  const onReject = async () => {
    try {
      await reject.mutateAsync({ paymentId: p.id, bookingId, reason: rejectReason || undefined });
      toast.success(t("payment.rejected"));
      setShowReject(false); setRejectReason("");
    } catch (e: any) { toast.error(e?.message ?? t("payment.actionFailed")); }
  };

  const copyHandle = async () => {
    const handle = receiverQ.data?.handle;
    if (!handle) return;
    try { await navigator.clipboard.writeText(handle); toast.success(t("payment.handleCopied")); } catch {}
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-navy/10 text-navy">
            {isCash ? <Banknote className="h-4 w-4" /> : <Wallet className="h-4 w-4" aria-label="InstaPay" />}
          </div>
          <div>
            <div className="text-sm font-extrabold">
              {isCash ? t("bookFlow.payCash") : t("bookFlow.payInstapay")}
            </div>
            <div className="text-[11px] text-muted-foreground">{formatEGP(Number(p.amount ?? 0))}</div>
          </div>
        </div>
        <Badge tone={statusTone(p.status)}>{t(`payment.status.${p.status}`, String(p.status).replace("_", " "))}</Badge>
      </div>

      {/* Customer InstaPay instructions + upload */}
      {viewer === "customer" && isInstapay && p.status === "pending_review" && !p.proof_path && (
        <div className="space-y-3 rounded-2xl bg-surface-2 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("payment.transferTo")}
          </div>
          {receiverQ.data ? (
            <>
              <button
                onClick={copyHandle}
                className="flex w-full items-center justify-between gap-2 rounded-xl bg-surface p-3 text-start active:scale-[0.99]"
                aria-label={t("payment.copyHandle")}
              >
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">{t("payment.instapayHandle")}</div>
                  <div className="truncate text-sm font-extrabold text-navy" dir="ltr">{receiverQ.data.handle}</div>
                </div>
                <Copy className="h-4 w-4 text-muted-foreground" />
              </button>
              {receiverQ.data.note && (
                <p className="text-[11px] text-muted-foreground">{receiverQ.data.note}</p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t("payment.handleNotConfigured")}</p>
          )}
          <label className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-navy/30 bg-navy/5 text-sm font-bold text-navy active:scale-[0.98]">
            <Upload className="h-4 w-4" /> {upload.isPending ? t("payment.uploading") : t("payment.uploadReceipt")}
            <input type="file" accept="image/*,application/pdf" onChange={onFile} disabled={upload.isPending} className="hidden" />
          </label>
        </div>
      )}

      {/* Proof uploaded — awaiting review */}
      {isInstapay && p.proof_path && p.status === "pending_review" && (
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-surface-2 p-3">
          <div className="flex items-center gap-2 text-xs">
            <ShieldCheck className="h-4 w-4 text-success" />
            <span className="font-semibold">{t("payment.awaitingReview")}</span>
          </div>
          <button onClick={openProof} className="grid h-9 w-9 place-items-center rounded-xl bg-surface" aria-label={t("payment.viewReceipt")}>
            <Eye className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Rejected — show reason + retry for customer */}
      {p.status === "rejected" && (
        <div className="rounded-2xl bg-coral/10 p-3">
          <div className="text-xs font-extrabold text-coral">{t("payment.rejectedTitle")}</div>
          {p.rejection_reason && (
            <p className="mt-1 text-[11px] text-muted-foreground">{p.rejection_reason}</p>
          )}
          {viewer === "customer" && isInstapay && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("payment.rejectedRetry")}
            </p>
          )}
        </div>
      )}

      {/* Provider/Admin actions */}
      {canConfirm && (p.status === "pending" || p.status === "pending_review") && (
        <div className="space-y-2 border-t border-border pt-3">
          {p.proof_path && (
            <button onClick={openProof} className="flex w-full items-center justify-center gap-2 rounded-xl bg-surface-2 py-2 text-xs font-bold">
              <Eye className="h-4 w-4" /> {t("payment.viewReceipt")}
            </button>
          )}
          <div className="flex gap-2">
            <button
              onClick={onCapture}
              disabled={capture.isPending}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-navy text-sm font-bold text-navy-foreground active:scale-[0.98] disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> {t("payment.markReceived")}
            </button>
            {isInstapay && (
              <button
                onClick={() => setShowReject(true)}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-coral text-sm font-bold text-coral active:scale-[0.98]"
              >
                <X className="h-4 w-4" /> {t("payment.reject")}
              </button>
            )}
          </div>
        </div>
      )}

      {p.status === "captured" && (
        <div className="flex items-center gap-2 rounded-2xl bg-mint/30 px-3 py-2 text-xs">
          <Check className="h-4 w-4 text-success" />
          <span className="font-semibold">{t("payment.confirmed")}</span>
        </div>
      )}

      {/* Reject dialog */}
      {showReject && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={() => setShowReject(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-extrabold">{t("payment.rejectDialogTitle")}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("payment.rejectDialogBody")}
            </p>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("payment.rejectReasonPlaceholder")}
              className="mt-3 w-full resize-none rounded-2xl border border-border bg-surface-2 p-3 text-sm outline-none"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowReject(false)} className="h-12 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold">{t("payment.cancel")}</button>
              <button onClick={onReject} disabled={reject.isPending} className="h-12 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground disabled:opacity-50">{t("payment.confirmReject")}</button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
