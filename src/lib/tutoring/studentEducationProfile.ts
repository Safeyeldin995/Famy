export type EducationProfileIds = {
  educationCurriculumId: string | null;
  educationLevelId: string | null;
};

export type FamilyMemberEducationRow = {
  id: string;
  full_name: string;
  education_curriculum_id?: string | null;
  education_level_id?: string | null;
};

export type CustomerEducationRow = {
  education_curriculum_id?: string | null;
  education_level_id?: string | null;
};

export function educationIdsFromFamilyMember(
  member: FamilyMemberEducationRow | null | undefined,
): EducationProfileIds {
  if (!member) {
    return { educationCurriculumId: null, educationLevelId: null };
  }
  return {
    educationCurriculumId: member.education_curriculum_id ?? null,
    educationLevelId: member.education_level_id ?? null,
  };
}

export function educationIdsFromCustomerProfile(
  profile: CustomerEducationRow | null | undefined,
): EducationProfileIds {
  if (!profile) {
    return { educationCurriculumId: null, educationLevelId: null };
  }
  return {
    educationCurriculumId: profile.education_curriculum_id ?? null,
    educationLevelId: profile.education_level_id ?? null,
  };
}

export function resolveStudentEducationProfile(args: {
  forWhom: string;
  customerProfile: CustomerEducationRow | null | undefined;
  customerFullName?: string | null;
  familyMembers: FamilyMemberEducationRow[];
}): EducationProfileIds & { studentFirstName: string | null; familyMemberId: string | null } {
  if (args.forWhom === "myself") {
    return {
      ...educationIdsFromCustomerProfile(args.customerProfile),
      studentFirstName: studentFirstNameFromProfile(args.customerFullName),
      familyMemberId: null,
    };
  }
  const member = args.familyMembers.find((row) => row.id === args.forWhom);
  const firstName = member?.full_name?.trim().split(/\s+/)[0] ?? null;
  return {
    ...educationIdsFromFamilyMember(member),
    studentFirstName: firstName,
    familyMemberId: member?.id ?? null,
  };
}

export function studentFirstNameFromProfile(fullName: string | null | undefined): string | null {
  const trimmed = fullName?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}
