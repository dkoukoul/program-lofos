import { describe, test, expect } from "bun:test";
import {
  checkOverlapPolicy,
  diffChangedFields,
  findOverlap,
  nextAvailableSundays,
  typeDefaults,
} from "./activities";

describe("typeDefaults", () => {
  test("typical: Λόφος 11:00-13:00, παγούρι", () => {
    expect(typeDefaults("typical")).toEqual({
      location: "Λόφος",
      startTime: "11:00",
      endTime: "13:00",
      whatToBring: "παγούρι",
    });
  });

  test("other: μόνο τι-να-κρατάνε", () => {
    expect(typeDefaults("other")).toEqual({ whatToBring: "πλήρης προσκοπική στολή" });
  });

  test("day_trip/multi_day/no_activity: κανένα default", () => {
    expect(typeDefaults("day_trip")).toEqual({});
    expect(typeDefaults("multi_day")).toEqual({});
    expect(typeDefaults("no_activity")).toEqual({});
  });
});

describe("nextAvailableSundays", () => {
  test("βρίσκει τις πρώτες Κυριακές της περιόδου όταν καμία δεν είναι κατειλημμένη", () => {
    const periodStart = new Date(2026, 6, 1); // Τετάρτη 1 Ιουλίου 2026
    const periodEnd = new Date(2026, 6, 31);
    const result = nextAvailableSundays([], periodStart, periodEnd, 3);
    expect(result.map((d) => d.getDay())).toEqual([0, 0, 0]);
    expect(result[0]!.getDate()).toBe(5);
    expect(result[1]!.getDate()).toBe(12);
    expect(result[2]!.getDate()).toBe(19);
  });

  test("παραλείπει Κυριακές που έχουν ήδη δράση", () => {
    const periodStart = new Date(2026, 6, 1);
    const periodEnd = new Date(2026, 6, 31);
    const occupied = [new Date(2026, 6, 5)];
    const result = nextAvailableSundays(occupied, periodStart, periodEnd, 2);
    expect(result.map((d) => d.getDate())).toEqual([12, 19]);
  });

  test("σέβεται τα όρια της περιόδου", () => {
    const periodStart = new Date(2026, 6, 20);
    const periodEnd = new Date(2026, 6, 31);
    const result = nextAvailableSundays([], periodStart, periodEnd, 5);
    expect(result.map((d) => d.getDate())).toEqual([26]);
  });
});

describe("findOverlap", () => {
  const day = new Date(2026, 6, 12);

  test("επιστρέφει την υπάρχουσα δράση την ίδια ημέρα", () => {
    const existing = { date: day, id: 1 };
    expect(findOverlap([existing], new Date(2026, 6, 12, 18, 0))).toBe(existing);
  });

  test("επιστρέφει null όταν δεν υπάρχει τίποτα", () => {
    expect(findOverlap([{ date: day }], new Date(2026, 6, 13))).toBeNull();
  });
});

describe("checkOverlapPolicy", () => {
  test("ok όταν δεν υπάρχει επικάλυψη", () => {
    expect(checkOverlapPolicy(null, false)).toBe("ok");
    expect(checkOverlapPolicy(null, true)).toBe("ok");
  });

  test("block όταν υπάρχει επικάλυψη και ALLOW_ACTIVITY_OVERLAP=false (default)", () => {
    expect(checkOverlapPolicy({ id: 1 }, false)).toBe("block");
  });

  test("warn όταν υπάρχει επικάλυψη και ALLOW_ACTIVITY_OVERLAP=true", () => {
    expect(checkOverlapPolicy({ id: 1 }, true)).toBe("warn");
  });
});

describe("diffChangedFields", () => {
  const base = {
    date: new Date(2026, 6, 12),
    location: "Λόφος",
    startsAt: new Date(2026, 6, 12, 11, 0),
    endsAt: new Date(2026, 6, 12, 13, 0),
    cost: null,
    whatToBring: "παγούρι",
  };

  test("καμία αλλαγή -> άδεια λίστα", () => {
    expect(diffChangedFields(base, { ...base })).toEqual([]);
  });

  test("εντοπίζει μόνο τα πεδία που πραγματικά άλλαξαν", () => {
    const after = { ...base, location: "Πλατεία" };
    expect(diffChangedFields(base, after)).toEqual(["location"]);
  });

  test("συσσωρεύει unique με τα ήδη υπάρχοντα changed fields", () => {
    const after = { ...base, cost: "5€" };
    expect(diffChangedFields(base, after, ["location"]).sort()).toEqual(["cost", "location"].sort());
  });

  test("δεν διπλασιάζει αν το ίδιο πεδίο αλλάζει ξανά", () => {
    const after = { ...base, location: "Πλατεία" };
    expect(diffChangedFields(base, after, ["location"])).toEqual(["location"]);
  });
});
