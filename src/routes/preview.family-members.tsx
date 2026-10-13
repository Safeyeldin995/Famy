import { createFileRoute } from "@tanstack/react-router";
import { FamilyMembers } from "./family-members";
import { NewFamilyMember } from "./family-members.new";
import { EditFamilyMemberContent } from "./family-members.$id";
import { CustomerPreview } from "./-customerPreview";

export const Route = createFileRoute("/preview/family-members")({
  validateSearch: (search: Record<string, unknown>) => ({
    memberId: typeof search.memberId === "string" ? search.memberId : undefined,
  }),
  component: PreviewFamilyMembers,
});

function PreviewFamilyMembers() {
  const { memberId } = Route.useSearch();
  return (
    <CustomerPreview>
      {memberId === "new" ? (
        <NewFamilyMember />
      ) : memberId ? (
        <EditFamilyMemberContent key={memberId} id={memberId} />
      ) : (
        <FamilyMembers />
      )}
    </CustomerPreview>
  );
}
