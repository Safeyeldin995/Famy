import { expect, it } from "vitest";
import { groupTeachingRows, teachingLevelDiff } from "../teachingGroups";
const row = {
  id: "one",
  provider_id: "p",
  service_id: "s",
  subject_id: "sub",
  curriculum_id: "c",
  level_id: "l1",
  session_duration_min: 60,
  session_price: 300,
  status: "pending",
};
it("groups across grades but never across providers, service, subject, curriculum, duration or price", () => {
  const rows = [row, { ...row, id: "two", level_id: "l2" }];
  expect(groupTeachingRows(rows)[0].rows).toHaveLength(2);
  for (const [key, value] of Object.entries({
    provider_id: "p2",
    service_id: "s2",
    subject_id: "sub2",
    curriculum_id: "c2",
    session_duration_min: 90,
    session_price: 400,
  }))
    expect(groupTeachingRows([row, { ...row, [key]: value }])).toHaveLength(2);
});
it("keeps approved rows locked even when unchecked and removes only non-approved rows", () => {
  const approved = { ...row, id: "approved", level_id: "l2", status: "approved" };
  expect(teachingLevelDiff([row, approved], ["l3", "l3", "l2"])).toEqual({
    upsert: ["l3"],
    removable: [row],
    lockedApproved: [approved],
  });
  expect(teachingLevelDiff([approved], []).removable).toEqual([]);
});
