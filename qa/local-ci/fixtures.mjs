// Deterministic local CI identities. They exist only in the throwaway Supabase
// stack started inside the CI runner; none of them is a real person or number.
// Phone numbers use the 0100 000 0xxx range so they read as test data.

export const LOCAL_CI_PASSWORD = "Famy-local-ci-2026!";

export const LOCAL_CI_USERS = {
  admin: {
    email: "admin@famy-local-ci.test",
    fullName: "أدمن التجربة",
    signupRole: "customer",
  },
  customer: {
    email: "parent@famy-local-ci.test",
    fullName: "منى التجربة",
    signupRole: "customer",
    phone: "01000000101",
    dateOfBirth: "1986-04-10",
  },
  // A parent who never entered their own birth date (most parents who sign up
  // only to book for a child).
  parentNoDob: {
    email: "parent2@famy-local-ci.test",
    fullName: "هالة التجربة",
    signupRole: "customer",
    phone: "01000000102",
  },
  tutor: {
    email: "tutor@famy-local-ci.test",
    fullName: "كريم المدرس",
    signupRole: "provider",
    phone: "01000000201",
  },
};

export const LOCAL_CI_CHILD = {
  fullName: "يوسف التجربة",
  firstName: "يوسف",
  dateOfBirth: "2013-03-01",
  curriculumCode: "eg_national_lang",
  levelCode: "g7",
};

export const LOCAL_CI_SECOND_CHILD = {
  fullName: "ليلى التجربة",
  firstName: "ليلى",
  dateOfBirth: "2012-09-15",
};

export const LOCAL_CI_TUTORING = {
  serviceSlug: "school-subject-tutoring",
  subjectCode: "math",
  durationMin: 60,
  inPersonPrice: 400,
  onlinePrice: 300,
};

export const LOCAL_CI_PROMO = {
  code: "ONLINE10",
  percent: 10,
};

export const LOCAL_CI_WALLET_CREDIT = 2000;

/** Files written by the seed for the Playwright run (gitignored under qa/.auth/). */
export const LOCAL_CI_STATE_DIR = "qa/.auth/local-ci";
