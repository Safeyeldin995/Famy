function localeFor(language: string) {
  return language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
}

export function formatChatListTime(iso: string | null, language: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const locale = localeFor(language);
  if (d.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(locale, {
      timeStyle: "short",
      timeZone: "Africa/Cairo",
    }).format(d);
  }
  const days = Math.floor((+now - +d) / 86400000);
  if (days < 7) {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      timeZone: "Africa/Cairo",
    }).format(d);
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "Africa/Cairo",
  }).format(d);
}

export function formatChatMessageTime(iso: string, language: string) {
  return new Intl.DateTimeFormat(localeFor(language), {
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(new Date(iso));
}
