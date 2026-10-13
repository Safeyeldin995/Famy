type NotificationText = {
  title: string;
  body?: string | null;
  title_ar?: string | null;
  title_en?: string | null;
  body_ar?: string | null;
  body_en?: string | null;
};
export function notificationText(n: NotificationText, language: string) {
  const ar = language.startsWith("ar");
  return {
    title: (ar ? n.title_ar : n.title_en)?.trim() || n.title,
    body: (ar ? n.body_ar : n.body_en)?.trim() || n.body,
  };
}
