import { useState } from "react";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import {
  ProviderSetupForm,
  setupItems,
  type SetupItem,
} from "@/components/provider/ProviderSetupForm";
import { GroupedTeachingSetup } from "@/components/provider/GroupedTeachingSetup";
import { defaultWorkingHours } from "@/lib/provider/setupHelpers";
import type { ProviderTeachingCapabilityRow } from "@/lib/db/teaching-queries";
export const Route = createFileRoute("/preview/pro/setup/$item")({
  beforeLoad: ({ params }) => {
    if (!setupItems.includes(params.item as SetupItem)) throw notFound();
  },
  component: PreviewSetup,
});
const base = { is_active: true, sort_order: 0 };
const subjects = [
  {
    ...base,
    id: "math",
    code: "math",
    name_ar: "رياضيات",
    name_en: "Mathematics",
    max_session_duration_min: 120,
  },
];
const curricula = [
  {
    ...base,
    id: "eg",
    code: "eg_national_ar",
    name_ar: "المنهج المصري",
    name_en: "Egyptian curriculum",
  },
];
const levels = [4, 5, 6].map((n) => ({
  ...base,
  id: `g${n}`,
  code: `g${n}`,
  name_ar: `الصف ${n}`,
  name_en: `Grade ${n}`,
}));
const services = [
  {
    id: "school",
    name_ar: "دروس",
    name_en: "Tutoring",
    minimum_price: 300,
    maximum_price: 1500,
    allowed_session_durations: [60],
  },
];
function PreviewSetup() {
  const { item } = Route.useParams();
  const nav = useNavigate();
  const back = () => {
    void nav({ to: "/preview/pro", search: { pending: 1 } });
  };
  const [rows, setRows] = useState<ProviderTeachingCapabilityRow[]>([
    {
      id: "preview-approved-grade",
      provider_id: "preview",
      service_id: "school",
      subject_id: "math",
      curriculum_id: "eg",
      level_id: "g4",
      session_duration_min: 60,
      session_price: 450,
      status: "approved",
      submitted_at: "2026-10-08",
      subject: subjects[0],
      curriculum: curricula[0],
      level: levels[0],
    },
  ]);
  if (item === "subjects")
    return (
      <GroupedTeachingSetup
        services={services}
        subjects={subjects}
        curricula={curricula}
        levels={levels}
        links={[{ service_id: "school", subject_id: "math" }]}
        rows={rows}
        onBack={back}
        onSave={async () => back()}
        onRemove={async (ids) =>
          setRows((current) =>
            current.filter((row) => row.status === "approved" || !ids.includes(row.id)),
          )
        }
      />
    );
  return (
    <ProviderSetupForm
      key={item}
      item={item as Exclude<SetupItem, "subjects">}
      snapshot={{
        profile: { full_name: "منى عادل" },
        provider: {
          years_experience: 3,
          bio_ar: "بحب الأطفال وبتعامل معاهم بصبر",
          max_children_per_booking: 2,
        },
        details: {
          date_of_birth: "1995-06-15",
          governorate: "الجيزة",
          area: "الشيخ زايد",
          full_address: "عنوان تجريبي",
        },
        age_group_capabilities: [{ code: "preschool" }],
        needsBabysitting: true,
      }}
      rules={defaultWorkingHours()}
      ageGroups={[
        { code: "preschool", name_ar: "قبل المدرسة", name_en: "Preschool" },
        { code: "school_age", name_ar: "سن المدرسة", name_en: "School age" },
      ]}
      onBack={back}
      onSave={async () => back()}
    />
  );
}
