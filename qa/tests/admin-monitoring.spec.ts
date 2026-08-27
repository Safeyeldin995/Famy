import { expect, test } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { captureErrors } from "./helpers";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

const QA_ERROR_MARKER = `QA_monitoring_seed_${Date.now()}`;

test("admin monitoring dashboard renders the three monitoring categories", async ({ page }) => {
  const { readErrors } = captureErrors(page);
  let seededErrorId: string | undefined;

  try {
    const { data: seeded, error: seedError } = await supabaseAdmin
      .from("error_logs")
      .insert({
        message_safe: QA_ERROR_MARKER,
        source: "server",
        context_route: "/admin/monitoring",
        context_label: "qa_monitoring_seed",
      })
      .select("id")
      .single();
    expect(seedError).toBeNull();
    seededErrorId = seeded?.id;

    await page.goto("/admin/monitoring");
    await expect(page.getByRole("heading", { name: /monitoring/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /recent application errors/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /failed or rejected payments/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /failed or dead notifications/i })).toBeVisible();
    await expect(page.getByText(QA_ERROR_MARKER)).toBeVisible({ timeout: 20_000 });

    expect(readErrors().console).toEqual([]);
    expect(readErrors().network.filter((entry) => !entry.includes("favicon"))).toEqual([]);
  } finally {
    if (seededErrorId) {
      await supabaseAdmin.from("error_logs").delete().eq("id", seededErrorId);
    }
  }
});

test("client error boundary logs a safe monitoring row on QA trigger route", async ({ page }) => {
  const marker = `qa_monitoring_boundary_test_${Date.now()}`;
  const { readErrors, stopCapture } = captureErrors(page);
  let loggedErrorId: string | undefined;

  try {
    await page.goto(`/monitoring-error?marker=${encodeURIComponent(marker)}`);
    await expect(page.getByText(/something went wrong|try again soon/i)).toBeVisible({
      timeout: 20_000,
    });

    await expect
      .poll(
        async () => {
          const { data, error } = await supabaseAdmin
            .from("error_logs")
            .select("id, message_safe, source, context_label")
            .eq("message_safe", marker)
            .order("created_at", { ascending: false })
            .limit(1);
          expect(error).toBeNull();
          const row = data?.[0] ?? null;
          if (row?.id) loggedErrorId = row.id;
          return row;
        },
        { timeout: 30_000 },
      )
      .toMatchObject({
        message_safe: marker,
        source: "client",
      });

    stopCapture();
    expect(readErrors().network.filter((entry) => !entry.includes("favicon"))).toEqual([]);
  } finally {
    if (loggedErrorId) {
      await supabaseAdmin.from("error_logs").delete().eq("id", loggedErrorId);
    }
  }
});
