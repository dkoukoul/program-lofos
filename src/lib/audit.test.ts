import { describe, expect, spyOn, test } from "bun:test";
import { activityAuditEntry, logActivityChange } from "./audit";

const base = {
  leader: { id: 8, name: "Βαθμοφόρος" },
  program: { id: 31, sectionId: 1 },
  activity: { id: 68, date: new Date(2026, 10, 22), type: "day_trip" },
  at: new Date("2026-11-16T08:08:48.000Z"),
};

describe("activityAuditEntry", () => {
  test("καταγράφει ποιος, πότε, ποια δράση και τι άλλαξε", () => {
    expect(activityAuditEntry({ ...base, action: "update", changedFields: ["type", "location"] })).toEqual({
      event: "activity_change",
      at: "2026-11-16T08:08:48.000Z",
      action: "update",
      leaderId: 8,
      leaderName: "Βαθμοφόρος",
      programId: 31,
      sectionId: 1,
      activityId: 68,
      activityDate: "2026-11-22",
      activityType: "day_trip",
      changedFields: ["type", "location"],
    });
  });

  test("χωρίς changedFields/detail δεν βάζει κενά κλειδιά", () => {
    const entry = activityAuditEntry({ ...base, action: "delete" });
    expect("changedFields" in entry).toBe(false);
    expect("detail" in entry).toBe(false);
  });

  test("δεν διαρρέει email ακόμα κι αν το leader object το έχει", () => {
    const leader = { ...base.leader, email: "x@example.com" };
    const line = JSON.stringify(activityAuditEntry({ ...base, leader, action: "create" }));
    expect(line).not.toContain("example.com");
  });
});

describe("logActivityChange", () => {
  test("γράφει μία JSON γραμμή στο stdout", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    logActivityChange({ ...base, action: "create" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0]![0] as string).activityId).toBe(68);
    spy.mockRestore();
  });
});
