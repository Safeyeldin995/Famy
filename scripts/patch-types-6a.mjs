import fs from "fs";
import { execSync } from "child_process";

const path = "src/integrations/supabase/types.ts";

function readTypesFile() {
  const buf = fs.readFileSync(path);
  const enc = buf[0] === 0xff && buf[1] === 0xfe ? "utf16le" : "utf8";
  return { text: buf.toString(enc), enc };
}

function tryGenerateFromLinkedSchema() {
  try {
    const generated = execSync("npx supabase gen types typescript --linked", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    fs.writeFileSync(path, generated, "utf8");
    console.log(`regenerated ${path} from linked schema`);
    return true;
  } catch (error) {
    console.warn("supabase gen types unavailable; falling back to deterministic patch script");
    if (error instanceof Error) {
      console.warn(error.message);
    }
    return false;
  }
}

function patchTypesDeterministically() {
  const { text, enc } = readTypesFile();
  let next = text;
  const markers = [
    "idempotency_key: string | null",
    "request_fingerprint: string | null",
    "create_booking:",
  ];

  if (!next.includes("bookings:")) {
    throw new Error(`patch-types-6a: expected bookings table block missing in ${path}`);
  }

  if (!next.includes("request_fingerprint")) {
    const rowNeedle = /(bookings: \{\r?\n        Row: \{[\s\S]*?notes: string \| null\r?\n)/;
    const insertNeedle = /(bookings: \{\r?\n        Row: \{[\s\S]*?Insert: \{[\s\S]*?notes\?: string \| null\r?\n)/;
    const updateNeedle = /(bookings: \{\r?\n        Row: \{[\s\S]*?Update: \{[\s\S]*?notes\?: string \| null\r?\n)/;
    if (!rowNeedle.test(next) || !insertNeedle.test(next) || !updateNeedle.test(next)) {
      throw new Error(`patch-types-6a: bookings idempotency anchor pattern missing in ${path}`);
    }
    next = next.replace(rowNeedle, "$1          idempotency_key: string | null\r\n          request_fingerprint: string | null\r\n");
    next = next.replace(insertNeedle, "$1          idempotency_key?: string | null\r\n          request_fingerprint?: string | null\r\n");
    next = next.replace(updateNeedle, "$1          idempotency_key?: string | null\r\n          request_fingerprint?: string | null\r\n");
  }

  if (!next.includes("create_booking:")) {
    if (!next.includes("cancel_booking: {")) {
      throw new Error(`patch-types-6a: cancel_booking RPC anchor missing in ${path}`);
    }
    next = next.replace(
      "cancel_booking: {",
      `create_booking: {
        Args: {
          p_provider_id: string
          p_service_id: string
          p_address_id: string
          p_start_at: string
          p_end_at: string
          p_idempotency_key: string
          p_family_member_id?: string | null
          p_notes?: string | null
          p_promo_code_id?: string | null
          p_requirement_selections?: Json
        }
        Returns: Json
      }
      cancel_booking: {`,
    );
  }

  for (const marker of markers) {
    if (!next.includes(marker)) {
      throw new Error(`patch-types-6a: expected marker missing after patch: ${marker}`);
    }
  }

  fs.writeFileSync(path, next, enc === "utf16le" ? "utf8" : enc);
  console.log(`patched ${path} (${enc === "utf16le" ? "converted to utf8" : enc})`);
}

if (!tryGenerateFromLinkedSchema()) {
  patchTypesDeterministically();
}
