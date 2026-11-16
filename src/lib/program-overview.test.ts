import { describe, expect, test } from "bun:test";
import {
  buildProgramTimeline,
  currentAndNextProgram,
  monthPeriod,
  monthTitle,
  sundayCoverage,
  sundaysInPeriod,
  suggestMonthToCreate,
  upcomingMonths,
} from "./program-overview";

// Δεκέμβριος 2026: Κυριακές 6, 13, 20, 27.
const december = { periodStart: new Date(2026, 11, 1), periodEnd: new Date(2026, 11, 31) };

describe("sundaysInPeriod", () => {
  test("επιστρέφει όλες τις Κυριακές της περιόδου", () => {
    expect(sundaysInPeriod(december.periodStart, december.periodEnd).map((d) => d.getDate())).toEqual([
      6, 13, 20, 27,
    ]);
  });

  test("συμπεριλαμβάνει τα άκρα όταν είναι Κυριακή", () => {
    const days = sundaysInPeriod(new Date(2026, 11, 6), new Date(2026, 11, 13));
    expect(days.map((d) => d.getDate())).toEqual([6, 13]);
  });
});

describe("buildProgramTimeline", () => {
  const own = [{ date: new Date(2026, 11, 13), id: "own" }];
  const system = [{ date: new Date(2026, 11, 20), id: "sys" }];

  test("κενές θέσεις μόνο στις Κυριακές χωρίς δράση (ούτε δική, ούτε Συστήματος)", () => {
    const timeline = buildProgramTimeline(own, system, december, { emptySundays: true });
    expect(timeline.map((item) => `${item.kind}:${item.date.getDate()}`)).toEqual([
      "empty:6",
      "activity:13",
      "system:20",
      "empty:27",
    ]);
  });

  test("χωρίς emptySundays (πρόγραμμα Συστήματος) δεν βγάζει κενές θέσεις", () => {
    const timeline = buildProgramTimeline(own, [], december, { emptySundays: false });
    expect(timeline.map((item) => item.kind)).toEqual(["activity"]);
  });

  test("δράση εκτός Κυριακής μπαίνει χρονολογικά ανάμεσα", () => {
    const friday = { date: new Date(2026, 11, 18), id: "fri" };
    const timeline = buildProgramTimeline([friday], [], december, { emptySundays: true });
    expect(timeline.map((item) => item.date.getDate())).toEqual([6, 13, 18, 20, 27]);
  });

  test("δράση το Σάββατο καλύπτει την επόμενη Κυριακή (καμία κενή θέση)", () => {
    const saturday = { date: new Date(2026, 11, 19), id: "sat" };
    const timeline = buildProgramTimeline([saturday], [], december, { emptySundays: true });
    expect(timeline.map((item) => `${item.kind}:${item.date.getDate()}`)).toEqual([
      "empty:6",
      "empty:13",
      "activity:19",
      "empty:27",
    ]);
  });
});

describe("sundayCoverage", () => {
  test("μετρά καλυμμένες Κυριακές και επιστρέφει μόνο τις μελλοντικές κενές", () => {
    const now = new Date(2026, 11, 15);
    const coverage = sundayCoverage([{ date: new Date(2026, 11, 13) }], december, now);
    expect(coverage.total).toBe(4);
    expect(coverage.covered).toBe(1);
    expect(coverage.missingUpcoming.map((d) => d.getDate())).toEqual([20, 27]);
  });

  test("δράση το προηγούμενο Σάββατο καλύπτει την Κυριακή — όχι όμως η Δευτέρα μετά", () => {
    const now = new Date(2026, 11, 1);
    const coverage = sundayCoverage(
      [{ date: new Date(2026, 11, 12) }, { date: new Date(2026, 11, 26) }, { date: new Date(2026, 11, 21) }],
      december,
      now,
    );
    expect(coverage.covered).toBe(2);
    expect(coverage.missingUpcoming.map((d) => d.getDate())).toEqual([6, 20]);
  });

  test("η σημερινή Κυριακή μετράει ως μελλοντική", () => {
    const coverage = sundayCoverage([], december, new Date(2026, 11, 20, 18, 0));
    expect(coverage.missingUpcoming.map((d) => d.getDate())).toEqual([20, 27]);
  });
});

describe("currentAndNextProgram", () => {
  const nov = { id: 1, periodStart: new Date(2026, 10, 1), periodEnd: new Date(2026, 10, 30) };
  const jan = { id: 3, periodStart: new Date(2027, 0, 1), periodEnd: new Date(2027, 0, 31) };
  const dec = { id: 2, ...december };

  test("τρέχον = καλύπτει σήμερα, επόμενο = το πλησιέστερο μελλοντικό", () => {
    const { current, next } = currentAndNextProgram([jan, nov, dec], new Date(2026, 10, 16));
    expect(current?.id).toBe(1);
    expect(next?.id).toBe(2);
  });

  test("η τελευταία μέρα της περιόδου μετράει ακόμα ως τρέχουσα", () => {
    expect(currentAndNextProgram([nov], new Date(2026, 10, 30, 20)).current?.id).toBe(1);
  });

  test("χωρίς προγράμματα → null/null", () => {
    expect(currentAndNextProgram([], new Date())).toEqual({ current: null, next: null });
  });
});

describe("μήνες", () => {
  test("monthPeriod: πρώτη έως τελευταία μέρα, ετικέτα σε ονομαστική", () => {
    const month = monthPeriod(2026, 11);
    expect(month.start).toEqual(new Date(2026, 11, 1));
    expect(month.end).toEqual(new Date(2026, 11, 31));
    expect(month.label).toBe("Δεκέμβριος 2026");
  });

  test("upcomingMonths περνάει σωστά την αλλαγή χρόνου", () => {
    expect(upcomingMonths(new Date(2026, 11, 20), 2).map((m) => m.label)).toEqual([
      "Δεκέμβριος 2026",
      "Ιανουάριος 2027",
    ]);
  });

  test("suggestMonthToCreate: τρέχων αν λείπει, αλλιώς επόμενος, αλλιώς null", () => {
    const now = new Date(2026, 10, 16);
    expect(suggestMonthToCreate([], now)?.label).toBe("Νοέμβριος 2026");
    const nov = { periodStart: new Date(2026, 10, 1), periodEnd: new Date(2026, 10, 30) };
    expect(suggestMonthToCreate([nov], now)?.label).toBe("Δεκέμβριος 2026");
    expect(suggestMonthToCreate([nov, december], now)).toBeNull();
  });

  test("suggestMonthToCreate: πρόγραμμα που καλύπτει μέρος του μήνα μετράει ως κάλυψη", () => {
    const partial = { periodStart: new Date(2026, 11, 10), periodEnd: new Date(2026, 11, 20) };
    const now = new Date(2026, 11, 1);
    expect(suggestMonthToCreate([partial], now)?.label).toBe("Ιανουάριος 2027");
  });

  test("monthTitle μόνο για ολόκληρο μήνα", () => {
    expect(monthTitle(december)).toBe("Δεκέμβριος 2026");
    expect(monthTitle({ periodStart: new Date(2026, 11, 1), periodEnd: new Date(2026, 11, 15) })).toBeNull();
  });
});
