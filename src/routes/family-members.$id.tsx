import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PhoneFrame, ErrorState } from "@/components/famio/ui";
import { CustomerPageHero } from "@/components/famio/CustomerPageHero";
import {
  FamilyMemberForm,
  emptyFamilyMemberFormValue,
  familyMemberFormValueToInput,
  familyMemberRowToFormValue,
  type FamilyMemberFormValue,
} from "@/components/famio/FamilyMemberForm";
import { useFamilyMember, useUpdateFamilyMember } from "@/lib/db/family-members-queries";

export const Route = createFileRoute("/family-members/$id")({ component: EditFamilyMember });

function EditFamilyMember() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const nav = useNavigate();
  const memberQ = useFamilyMember(id);
  const updateMember = useUpdateFamilyMember();
  const [value, setValue] = useState<FamilyMemberFormValue>(emptyFamilyMemberFormValue());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (memberQ.data && !loaded) {
      setValue(familyMemberRowToFormValue(memberQ.data));
      setLoaded(true);
    }
  }, [memberQ.data, loaded]);

  const submit = async () => {
    try {
      await updateMember.mutateAsync({ id, ...familyMemberFormValueToInput(value) });
      toast.success(t("familyMembers.saved", "Family member saved"));
      nav({ to: "/family-members" });
    } catch (e: any) {
      toast.error(e?.message ?? t("common.somethingWentWrong"));
    }
  };

  if (memberQ.isLoading) {
    return (
      <PhoneFrame bg="bg-background">
        <CustomerPageHero title={t("common.edit")} backTo="/family-members" />
        <div className="grid flex-1 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        </div>
      </PhoneFrame>
    );
  }
  if (!memberQ.data) {
    return (
      <PhoneFrame bg="bg-background">
        <CustomerPageHero title={t("common.edit")} backTo="/family-members" />
        <ErrorState title={t("familyMembers.notFound", "Family member not found")} />
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHero title={t("common.edit")} backTo="/family-members" />
      <div className="flex-1 px-6 pb-10 pt-2">
        <FamilyMemberForm
          value={value}
          onChange={setValue}
          onSubmit={submit}
          submitting={updateMember.isPending}
          submitLabel={t("common.save")}
        />
      </div>
    </PhoneFrame>
  );
}
