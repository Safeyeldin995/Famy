import { useState } from "react";
import { Drawer } from "vaul";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import "@/components/famio/providerApply.css";
import {
  FamilyMemberForm,
  emptyFamilyMemberFormValue,
  familyMemberFormValueToInput,
} from "@/components/famio/FamilyMemberForm";
import { useCreateFamilyMember } from "@/lib/db/family-members-queries";
import { familyMemberErrorMessageKey } from "@/lib/db/familyMemberErrors";

export type CreatedChild = {
  id: string;
  education_curriculum_id: string | null;
  education_level_id: string | null;
};

/**
 * «ضيف ابن» in place: the learner picker and «أبنائي» stay mounted, and the new
 * child comes back through `onCreated` so the caller can select it. The website
 * has no /family-members pages (they redirect to the home page), so never navigate there.
 */
export function AddChildSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (member: CreatedChild) => void;
}) {
  const { t, i18n } = useTranslation();
  const [value, setValue] = useState(emptyFamilyMemberFormValue);
  const [error, setError] = useState("");
  const create = useCreateFamilyMember();
  const pending = create.isPending;

  const save = async () => {
    setError("");
    try {
      const row = await create.mutateAsync(familyMemberFormValueToInput(value));
      toast.success(t("familyMembers.saved"));
      onCreated({
        id: row.id,
        education_curriculum_id: row.education_curriculum_id ?? null,
        education_level_id: row.education_level_id ?? null,
      });
    } catch (e: unknown) {
      setError(t(familyMemberErrorMessageKey(e)));
    }
  };

  return (
    <Drawer.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      dismissible={!pending}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Drawer.Content
          className="apply-ui apply-sheet"
          dir={i18n.dir()}
          aria-describedby={undefined}
        >
          <div className="apply-grab" />
          <div className="flex items-center justify-between">
            <Drawer.Title className="text-lg font-extrabold">
              {t("studentMatch.addChild")}
            </Drawer.Title>
            <button
              type="button"
              disabled={pending}
              className="apply-back"
              onClick={onClose}
              aria-label={t("providerApply.close")}
            >
              <X size={18} />
            </button>
          </div>
          <div className="max-h-[70dvh] overflow-y-auto pb-6">
            {error ? (
              <p role="alert" className="mb-3 text-pro-13 text-destructive">
                {error}
              </p>
            ) : null}
            <FamilyMemberForm
              nestedDatePicker
              value={value}
              onChange={setValue}
              onSubmit={() => void save()}
              submitting={pending}
              submitLabel={t("common.save")}
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
