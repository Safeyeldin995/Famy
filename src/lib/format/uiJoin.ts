/** List separator for inline UI copy — middle dot confuses Arabic readers (looks like ٠). */
export function uiListSeparator(language: string) {
  return language.startsWith("ar") ? "، " : " · ";
}

export function joinUiParts(parts: readonly string[], language: string) {
  return parts.filter((part) => part.length > 0).join(uiListSeparator(language));
}
