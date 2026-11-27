/**
 * «أبنائي» in the app-style customer pages. The website uses /online/students.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PhoneFrame } from "@/components/famio/ui";
import { CustomerPageHeader } from "@/components/famio/CustomerPageHeader";
import { StudentsManager } from "@/components/student/StudentsManager";

type StudentsSearch = { confirm?: string };

export const Route = createFileRoute("/account/students")({
  validateSearch: (search: Record<string, unknown>): StudentsSearch => ({
    confirm: typeof search.confirm === "string" && search.confirm ? search.confirm : undefined,
  }),
  component: AccountStudents,
});

function AccountStudents() {
  const { t } = useTranslation();
  const nav = useNavigate({ from: "/account/students" });
  const search = Route.useSearch();
  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHeader
        title={t("studentMatch.page.title")}
        subtitle={t("studentMatch.page.lead")}
        backTo="/profile"
      />
      <div className="flex-1 px-5 pb-28 pt-4">
        <StudentsManager
          confirm={search.confirm}
          onClearConfirm={() => void nav({ search: {}, replace: true })}
          signInTo="/login"
        />
      </div>
    </PhoneFrame>
  );
}
