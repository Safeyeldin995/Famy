import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { readLanguageCookie } from "./languageCookie";

export const getInitialLanguage = createServerFn({ method: "GET" }).handler(
  () => readLanguageCookie(getRequestHeader("cookie") ?? "") ?? "en",
);
