// QA-only helper: loads .env / .env.local into process.env for Node scripts
// run directly (outside Vite). Never imported by app/browser code.
// Never logs secret values.
import fs from 'fs';
import path from 'path';

function applyEnvFile(envPath, { override = false } = {}) {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (override || !(key in process.env)) process.env[key] = value;
  }
}

export function loadEnv() {
  applyEnvFile(path.resolve(process.cwd(), '.env'));
  applyEnvFile(path.resolve(process.cwd(), '.env.local'), { override: true });
}

/** Vercel Deployment Protection bypass headers for protected Preview/Production URLs. */
export function vercelBypassHeaders() {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return undefined;
  return {
    'x-vercel-protection-bypass': secret,
    'x-vercel-set-bypass-cookie': 'true',
  };
}
