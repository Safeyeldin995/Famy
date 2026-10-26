import { File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
export async function shareBookingFile(name: string, contents: string, mime: string) {
  if (!(await isAvailableAsync())) throw new Error("Sharing unavailable");
  const file = new File(Paths.cache, name.replace(/[^a-zA-Z0-9_.-]/g, "_"));
  file.write(contents);
  try {
    await shareAsync(file.uri, {
      mimeType: mime,
      UTI: mime === "text/calendar" ? "public.calendar-event" : "public.plain-text",
    });
  } finally {
    if (file.exists) file.delete();
  }
}
