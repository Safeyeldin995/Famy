import type { ReactNode } from "react";
import { LessonIllustration } from "@/components/lessons/LessonIllustration";
import { lessonIllustrationKeyForSubject } from "@/lib/tutoring/lessonIllustrations";

export function LessonSubjectIcon({
  subjectCode,
  label,
  className = "h-6 w-6",
  fallback,
}: {
  subjectCode?: string | null;
  label: string;
  className?: string;
  fallback: ReactNode;
}) {
  if (!lessonIllustrationKeyForSubject(subjectCode)) return <>{fallback}</>;
  return <LessonIllustration subjectCode={subjectCode} label={label} className={className} />;
}
