import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyCredentials } from "@/lib/provider/credentialQueries";
import { ProfileCompletionCard } from "./ProfileCompletionCard";

const TEACHING_SLUGS = new Set(["tutoring", "quran", "music"]);
const APPROVED_EDITABLE = ["experience", "education", "certificates"] as const;

/**
 * «كمل ملفك» on the approved provider's home. Everything the approval needed is already
 * done; teaching data and hours have their own banners there, so this card carries the
 * extras an approved provider can still add: experience, education and certificates.
 */
export function ApprovedProfileCompletion({ providerId }: { providerId: string | undefined }) {
  const credentials = useMyCredentials(providerId);
  const categories = useQuery({
    enabled: !!providerId,
    queryKey: ["my-provider-service-categories", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_services")
        .select("service:services(category:categories(slug))")
        .eq("provider_id", providerId!);
      if (error) throw error;
      return ((data ?? []) as { service?: { category?: { slug?: string } | null } | null }[])
        .map((row) => row.service?.category?.slug)
        .filter((slug): slug is string => !!slug);
    },
  });
  if (!credentials.data || !categories.data) return null;
  const slugs = categories.data;
  return (
    <ProfileCompletionCard
      only={APPROVED_EDITABLE}
      data={{
        photo: true,
        about: true,
        hours: true,
        personal: true,
        reference: true,
        babysitting: true,
        subjects: true,
        needsBabysitting: slugs.includes("babysitting"),
        needsSubjects: slugs.some((slug) => TEACHING_SLUGS.has(slug)),
        educationCount: credentials.data.education.length,
        experienceCount: credentials.data.experience.length,
        certificateCount: credentials.data.certificates.length,
      }}
    />
  );
}
