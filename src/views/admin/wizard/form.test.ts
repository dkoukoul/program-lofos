import { describe, expect, test } from "bun:test";
import { roundToNearestTenMinutes } from "./form";

describe("roundToNearestTenMinutes", () => {
  test("leaves values already on a 10-minute boundary unchanged", () => {
    expect(roundToNearestTenMinutes("11:00")).toBe("11:00");
    expect(roundToNearestTenMinutes("13:30")).toBe("13:30");
  });

  test("rounds down when closer to the previous 10-minute mark", () => {
    expect(roundToNearestTenMinutes("11:04")).toBe("11:00");
  });

  test("rounds up when closer to the next 10-minute mark", () => {
    expect(roundToNearestTenMinutes("11:05")).toBe("11:10");
    expect(roundToNearestTenMinutes("11:06")).toBe("11:10");
  });

  test("carries into the next hour when rounding up past :55", () => {
    expect(roundToNearestTenMinutes("11:56")).toBe("12:00");
  });

  test("wraps from hour 23 to hour 00 when rounding up past :55", () => {
    expect(roundToNearestTenMinutes("23:57")).toBe("00:00");
  });

  test("leaves an empty value unchanged", () => {
    expect(roundToNearestTenMinutes("")).toBe("");
  });
});
