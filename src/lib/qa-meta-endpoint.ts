// Typed bridge to the QA runtime identity handler (implementation lives in qa/*.mjs).
// @ts-expect-error — .mjs module has no generated declarations
import { handleQaMetaRequest as handleQaMetaRequestImpl } from "../../qa/runtime-identity-build.mjs";

export function handleQaMetaRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Response | null {
  return handleQaMetaRequestImpl(request, env);
}
