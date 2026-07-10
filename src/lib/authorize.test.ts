import { describe, test, expect } from "bun:test";
import type { Leader } from "../db/schema";
import { canEditSection } from "./authorize";

function makeLeader(overrides: Partial<Leader>): Leader {
  return {
    id: 1,
    name: "Test",
    email: "test@example.com",
    role: "section_leader",
    sectionId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("canEditSection", () => {
  test("system_staff can edit any section", () => {
    const staff = makeLeader({ role: "system_staff", sectionId: null });
    expect(canEditSection(staff, 42)).toBe(true);
  });

  test("section_leader can edit their own section", () => {
    const leader = makeLeader({ role: "section_leader", sectionId: 1 });
    expect(canEditSection(leader, 1)).toBe(true);
  });

  test("section_leader cannot edit a different section", () => {
    const leader = makeLeader({ role: "section_leader", sectionId: 1 });
    expect(canEditSection(leader, 2)).toBe(false);
  });
});
