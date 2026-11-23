import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { formatEGP } from "@/lib/utils";

type RefundRow = {
  id: string;
  amount: number;
  created_at: string;
  customer_id: string;
  payment_id: string;
  status: string;
};

export const Route = createFileRoute("/admin/wallet-refunds")({
  component: AdminWalletRefundsPage,
});

async function loadPendingRefunds(): Promise<RefundRow[]> {
  const { data, error } = await supabase
    .from("customer_wallet_refund_requests" as never)
    .select("id, amount, created_at, customer_id, payment_id, status")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RefundRow[];
}

async function postWalletRefundAction(body: Record<string, string>) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("auth");
  const response = await fetch("/api/admin/wallet-refund", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "failed");
}

function AdminWalletRefundsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-wallet-refunds"], queryFn: loadPendingRefunds });

  const approve = useMutation({
    mutationFn: async (requestId: string) => postWalletRefundAction({ action: "approve", requestId }),
    onSuccess: () => {
      toast.success(t("admin.walletRefunds.approved"));
      void qc.invalidateQueries({ queryKey: ["admin-wallet-refunds"] });
      void qc.invalidateQueries({ queryKey: ["admin-work-queue-counts"] });
    },
    onError: () => toast.error(t("admin.walletRefunds.actionFailed")),
  });

  const reject = useMutation({
    mutationFn: async (requestId: string) => {
      const reason = window.prompt(t("admin.walletRefunds.rejectPrompt"));
      if (!reason?.trim()) throw new Error("reason_required");
      await postWalletRefundAction({ action: "reject", requestId, reason: reason.trim() });
    },
    onSuccess: () => {
      toast.success(t("admin.walletRefunds.rejected"));
      void qc.invalidateQueries({ queryKey: ["admin-wallet-refunds"] });
      void qc.invalidateQueries({ queryKey: ["admin-work-queue-counts"] });
    },
    onError: () => toast.error(t("admin.walletRefunds.actionFailed")),
  });

  if (q.isError) {
    return <AdminQueryError message={t("admin.walletRefunds.loadError")} onRetry={() => q.refetch()} />;
  }
  const rows = q.data ?? [];

  return (
    <main className="admin-screen space-y-4 p-4">
      <h1 className="text-xl font-bold">{t("admin.walletRefunds.title")}</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.walletRefunds.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-sm font-semibold">{formatEGP(row.amount)}</p>
              <p className="text-xs text-muted-foreground">{row.created_at}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(row.id)}
                >
                  {t("admin.walletRefunds.approve")}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-border px-3 py-2 text-xs font-bold"
                  disabled={reject.isPending}
                  onClick={() => reject.mutate(row.id)}
                >
                  {t("admin.walletRefunds.reject")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}