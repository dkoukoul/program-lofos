import { describe, test, expect } from "bun:test";
import { SECTION_DOCUMENTS, SECTION_ORDER } from "./layout";

describe("SECTION_DOCUMENTS", () => {
  test("κάθε δηλωμένο έγγραφο αντιστοιχεί σε υπαρκτό αρχείο στο public/docs", async () => {
    for (const type of SECTION_ORDER) {
      for (const document of SECTION_DOCUMENTS[type]) {
        const path = `.${document.href}`;
        expect(await Bun.file(path).exists(), `${type}: λείπει το ${path}`).toBe(true);
      }
    }
  });

  test("το Ατομικό Δελτίο Υγείας προσφέρεται σε όλα τα τμήματα", () => {
    for (const type of SECTION_ORDER) {
      const labels = SECTION_DOCUMENTS[type].map((document) => document.label);
      expect(labels).toContain("Ατομικό Δελτίο Υγείας");
    }
  });

  test("το ενημερωτικό γονέων κατεβαίνει με ξεχωριστό όνομα ανά τμήμα", () => {
    const guides = SECTION_ORDER.flatMap((type) =>
      SECTION_DOCUMENTS[type].filter((document) => document.label === "Ενημερωτικό γονέων"),
    );
    const names = guides.map((document) => document.downloadName);
    expect(names).toEqual(["Ενημερωτικό γονέων Αγέλης.pdf", "Ενημερωτικό γονέων Ομάδας.pdf"]);
    expect(new Set(guides.map((document) => document.href)).size).toBe(2);
  });
});
