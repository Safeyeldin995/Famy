import { describe, expect, it } from "vitest";
import { profileCompletionModel, type ProfileCompletionData } from "../profileCompletionModel";
import { groupServicesByDoor, resumeApplyStep, serviceDoor } from "../applyServiceDoors";
import {
  credentialFileError,
  credentialFilePath,
  validateCertificate,
  validateEducation,
  validateExperience,
  yearOrNull,
  yearRange,
} from "../credentials";

const base: ProfileCompletionData = {
  photo: false,
  about: false,
  hours: false,
  personal: false,
  reference: false,
  babysitting: false,
  subjects: false,
  needsBabysitting: false,
  needsSubjects: true,
  educationCount: 0,
  experienceCount: 0,
  certificateCount: 0,
};

describe("profileCompletionModel", () => {
  it("orders by impact and tags only the existing approval requirements", () => {
    const m = profileCompletionModel(base);
    expect(m.items.map((i) => i.key)).toEqual([
      "photo",
      "subjects",
      "hours",
      "about",
      "experience",
      "education",
      "certificates",
      "reference",
      "personal",
    ]);
    expect(m.items.filter((i) => i.required).map((i) => i.key)).toEqual([
      "photo",
      "about",
      "reference",
      "personal",
    ]);
    expect(m.items[0].next).toBe(true);
    expect(m.percent).toBe(0);
  });

  it("babysitters get no education row; experience and certificates stay", () => {
    const m = profileCompletionModel({ ...base, needsSubjects: false, needsBabysitting: true });
    const keys = m.items.map((i) => i.key);
    expect(keys).not.toContain("education");
    expect(keys).not.toContain("subjects");
    expect(keys).toContain("babysitting");
    expect(keys).toContain("experience");
    expect(keys).toContain("certificates");
  });

  it("collapses done items and completes at 100%", () => {
    const partial = profileCompletionModel({ ...base, photo: true, educationCount: 2 });
    expect(partial.done.map((i) => i.key)).toEqual(["photo", "education"]);
    expect(partial.todo[0].key).toBe("subjects");
    expect(partial.complete).toBe(false);
    const full = profileCompletionModel({
      ...base,
      photo: true,
      about: true,
      hours: true,
      personal: true,
      reference: true,
      subjects: true,
      educationCount: 1,
      experienceCount: 1,
      certificateCount: 1,
    });
    expect(full.percent).toBe(100);
    expect(full.complete).toBe(true);
    expect(full.strokeDashoffset).toBe(0);
  });

  it("`only` limits the card to editable items", () => {
    const m = profileCompletionModel({ ...base, experienceCount: 1 }, [
      "experience",
      "education",
      "certificates",
    ]);
    expect(m.items.map((i) => i.key)).toEqual(["experience", "education", "certificates"]);
    expect(m.percent).toBe(33);
    expect(m.items.some((i) => i.required)).toBe(false);
  });
});

describe("service doors", () => {
  it("recognises Quran and music before and after the category split", () => {
    expect(serviceDoor({ slug: "quran-lessons", category: { slug: "tutoring" } })).toBe("quran");
    expect(serviceDoor({ slug: "x", category: { slug: "quran" } })).toBe("quran");
    expect(serviceDoor({ slug: "music-lessons", category: { slug: "tutoring" } })).toBe("music");
    expect(serviceDoor({ slug: "hourly-babysitting", category: { slug: "babysitting" } })).toBe(
      "babysitting",
    );
    expect(serviceDoor({ slug: "language-tutoring", category: { slug: "tutoring" } })).toBe(
      "lessons",
    );
  });

  it("groups in door order and drops empty doors", () => {
    const groups = groupServicesByDoor([
      { slug: "hourly-babysitting", category: { slug: "babysitting" } },
      { slug: "quran-lessons", category: { slug: "tutoring" } },
      { slug: "language-tutoring", category: { slug: "tutoring" } },
    ]);
    expect(groups.map((g) => g.door)).toEqual(["lessons", "quran", "babysitting"]);
  });

  it("resumes at the first unfinished step", () => {
    expect(resumeApplyStep({ basicsReady: false, servicesReady: true })).toBe(1);
    expect(resumeApplyStep({ basicsReady: true, servicesReady: false })).toBe(2);
    expect(resumeApplyStep({ basicsReady: true, servicesReady: true })).toBe(3);
  });
});

describe("credential validation", () => {
  it("requires institution and degree, checks years", () => {
    expect(
      validateEducation({ institution: "", degree: "", field_of_study: "", start_year: "", end_year: "" }),
    ).toEqual({ institution: "required", degree: "required" });
    expect(
      validateEducation({
        institution: "جامعة عين شمس",
        degree: "بكالوريوس",
        field_of_study: "",
        start_year: "2020",
        end_year: "2018",
      }),
    ).toEqual({ end_year: "yearOrder" });
    expect(
      validateEducation({
        institution: "جامعة عين شمس",
        degree: "بكالوريوس",
        field_of_study: "",
        start_year: "١٩٤٠",
        end_year: "",
      }),
    ).toEqual({ start_year: "year" });
  });

  it("current experience ignores the end year", () => {
    expect(
      validateExperience({
        role_title: "مدرس إنجليزي",
        place: "مدرسة النصر",
        start_year: "2019",
        end_year: "1990",
        is_current: true,
        description: "",
      }),
    ).toEqual({});
  });

  it("a certificate needs a file", () => {
    expect(
      validateCertificate({ title: "TEFL", issuer: "British Council", issued_year: "", hasFile: false }),
    ).toEqual({ hasFile: "file" });
  });

  it("reads Arabic digits as years and formats ranges", () => {
    expect(yearOrNull("٢٠١٨")).toBe(2018);
    expect(yearOrNull("")).toBeNull();
    expect(yearRange(2018, 2022, false, "لحد دلوقتي")).toBe("2018 – 2022");
    expect(yearRange(2020, null, true, "لحد دلوقتي")).toBe("2020 – لحد دلوقتي");
    expect(yearRange(null, null, false, "x")).toBe("");
  });

  it("keeps files in the provider folder with a safe extension", () => {
    expect(credentialFilePath("p1", "certificate", "my cert.PDF", "application/pdf", "u1")).toBe(
      "p1/certificate/u1.pdf",
    );
    expect(credentialFilePath("p1", "certificate", "x.exe", "image/png", "u2")).toBe(
      "p1/certificate/u2.png",
    );
    expect(credentialFileError(1000, "application/pdf")).toBeNull();
    expect(credentialFileError(1000, "text/html")).toBe("type");
    expect(credentialFileError(11 * 1024 * 1024, "image/png")).toBe("size");
  });
});
