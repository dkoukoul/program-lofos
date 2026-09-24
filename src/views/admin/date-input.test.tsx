import { describe, expect, test } from "bun:test";
import { DATE_PLACEHOLDER, DateInput, formatDateInputValue } from "./date-input";

describe("formatDateInputValue", () => {
  test("μετατρέπει ISO yyyy-mm-dd σε ηη/μμ/εεεε", () => {
    expect(formatDateInputValue("2026-08-05")).toBe("05/08/2026");
    expect(formatDateInputValue("2026-12-31")).toBe("31/12/2026");
  });

  test("επιστρέφει κενό για κενή ή μη έγκυρη τιμή", () => {
    expect(formatDateInputValue("")).toBe("");
    expect(formatDateInputValue("05/08/2026")).toBe("");
    expect(formatDateInputValue("2026-8-5")).toBe("");
  });
});

describe("DateInput", () => {
  test("δείχνει την ελληνική μορφή και κρατά την ISO τιμή στο native input", () => {
    const html = (<DateInput id="date" name="date" value="2026-08-05" required />).toString();
    expect(html).toContain("05/08/2026");
    expect(html).toContain('type="date"');
    expect(html).toContain('name="date"');
    expect(html).toContain('value="2026-08-05"');
    expect(html).toContain("required");
  });

  test("δείχνει placeholder όταν δεν υπάρχει τιμή", () => {
    const html = (<DateInput name="periodStart" />).toString();
    expect(html).toContain(DATE_PLACEHOLDER);
    expect(html).toContain("is-empty");
  });

  test("περνά τα htmx attributes στο ίδιο το input (hx-include/#id συνεχίζουν να δουλεύουν)", () => {
    const html = (
      <DateInput id="date" name="date" value="2026-08-05" hx={{ "hx-get": "/check", "hx-trigger": "change" }} />
    ).toString();
    expect(html).toContain('hx-get="/check"');
    expect(html).toContain('hx-trigger="change"');
  });
});
