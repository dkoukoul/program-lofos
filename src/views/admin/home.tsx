import type { Activity, Leader, Program, sections } from "../../db/schema";
import { ACTIVITY_TYPE_INFO, SECTION_LABELS, formatDateNumeric } from "../public/layout";
import { toTimeInputValue } from "./wizard/form";
import { AdminLayout } from "./layout";

type SectionRow = typeof sections.$inferSelect;
type SectionType = SectionRow["type"];

const STATUS_LABELS: Record<Program["status"], string> = {
  draft: "Πρόχειρο",
  published: "Δημοσιευμένο",
};

export type HomeRow = { activity: Activity; program: Program };

export type HomeSortColumn = "date" | "section" | "type" | "location" | "status";
export type SortDir = "asc" | "desc";

const COLUMNS: { key: HomeSortColumn; label: string }[] = [
  { key: "date", label: "Ημερομηνία" },
  { key: "section", label: "Τμήμα" },
  { key: "type", label: "Τύπος" },
  { key: "location", label: "Τόπος" },
  { key: "status", label: "Κατάσταση" },
];

const monthLabelFormatter = new Intl.DateTimeFormat("el-GR", { month: "long", year: "numeric" });

function sectionKey(program: Program, sectionsById: Map<number, SectionRow>): "system" | SectionType {
  return program.sectionId === null ? "system" : sectionsById.get(program.sectionId)!.type;
}

function sectionLabel(program: Program, sectionsById: Map<number, SectionRow>): string {
  const key = sectionKey(program, sectionsById);
  return key === "system" ? "Σύστημα" : SECTION_LABELS[key];
}

function toMonthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthValue: string): string {
  const [y, m] = monthValue.split("-").map(Number);
  return monthLabelFormatter.format(new Date(y!, m! - 1, 1));
}

/** Ετικέτες τμήματος/τύπου/κατάστασης για μία γραμμή — reused τόσο στην πλήρη λίστα όσο και στα htmx row-partials. */
export function rowLabels(
  row: HomeRow,
  sectionsById: Map<number, SectionRow>,
): { sectionText: string; typeText: string; statusText: string } {
  return {
    sectionText: sectionLabel(row.program, sectionsById),
    typeText: ACTIVITY_TYPE_INFO[row.activity.type].label,
    statusText: STATUS_LABELS[row.program.status],
  };
}

export function quickEditUrl(row: HomeRow): string {
  return `/admin/programs/${row.program.id}/activities/${row.activity.id}/quick-edit`;
}

function rowViewUrl(row: HomeRow): string {
  return `/admin/programs/${row.program.id}/activities/${row.activity.id}/row`;
}

/** Γραμμή προβολής (κατάσταση ηρεμίας) — ίδιο markup στην αρχική σελίδα και στα htmx swaps μετά από αποθήκευση/άκυρο. */
export function ActivityRow({
  row,
  sectionText,
  typeText,
  statusText,
}: {
  row: HomeRow;
  sectionText: string;
  typeText: string;
  statusText: string;
}) {
  const { activity, program } = row;
  const canQuickEdit = activity.type !== "no_activity";
  const editUrl = `/admin/programs/${program.id}/activities/${activity.id}/edit`;

  return (
    <tr id={`activity-row-${activity.id}`} class="home-row">
      <td>{formatDateNumeric(activity.date)}</td>
      <td>{sectionText}</td>
      <td>{typeText}</td>
      <td>{activity.location ?? "—"}</td>
      <td>
        <span class={`badge badge-status-${program.status}`}>{statusText}</span>
      </td>
      <td class="home-row-actions">
        {canQuickEdit && (
          <button
            type="button"
            class="icon-btn"
            title="Γρήγορη επεξεργασία"
            aria-label="Γρήγορη επεξεργασία"
            hx-get={quickEditUrl(row)}
            hx-target={`#activity-row-${activity.id}`}
            hx-swap="outerHTML"
          >
            ✎
          </button>
        )}
        <a class="icon-btn" title="Λεπτομέρειες & πλήρης επεξεργασία" aria-label="Λεπτομέρειες & πλήρης επεξεργασία" href={editUrl}>
          ⤢
        </a>
      </td>
    </tr>
  );
}

/** Γραμμή σε κατάσταση quick-edit — inline φόρμα (τόπος + ώρα) μέσα στο ίδιο tr, χωρίς πλοήγηση στο πλήρες wizard. */
export function ActivityRowEditForm({
  row,
  sectionText,
  typeText,
  statusText,
}: {
  row: HomeRow;
  sectionText: string;
  typeText: string;
  statusText: string;
}) {
  const { activity } = row;

  return (
    <tr id={`activity-row-${activity.id}`} class="home-row home-row--editing">
      <td>{formatDateNumeric(activity.date)}</td>
      <td>{sectionText}</td>
      <td>{typeText}</td>
      <td colspan={3}>
        <form
          class="quick-edit-form"
          hx-post={quickEditUrl(row)}
          hx-target={`#activity-row-${activity.id}`}
          hx-swap="outerHTML"
        >
          <input type="text" name="location" value={activity.location ?? ""} placeholder="Τόπος" maxlength={200} />
          <span class="quick-edit-time">
            <input type="time" name="startTime" value={activity.startsAt ? toTimeInputValue(activity.startsAt) : ""} />
            <span aria-hidden="true">–</span>
            <input type="time" name="endTime" value={activity.endsAt ? toTimeInputValue(activity.endsAt) : ""} />
          </span>
          <span class="quick-edit-actions">
            <button type="submit" class="icon-btn icon-btn-primary" title="Αποθήκευση" aria-label="Αποθήκευση">
              ✓
            </button>
            <button
              type="button"
              class="icon-btn"
              title="Άκυρο"
              aria-label="Άκυρο"
              hx-get={rowViewUrl(row)}
              hx-target={`#activity-row-${activity.id}`}
              hx-swap="outerHTML"
            >
              ✕
            </button>
          </span>
        </form>
      </td>
    </tr>
  );
}

export function AdminHomePage({
  leader,
  rows,
  sectionsById,
  sectionFilter,
  monthFilter,
  sort,
  dir,
}: {
  leader: Leader;
  rows: HomeRow[];
  sectionsById: Map<number, SectionRow>;
  sectionFilter: string;
  monthFilter: string;
  sort: HomeSortColumn;
  dir: SortDir;
}) {
  const months = Array.from(new Set(rows.map((r) => toMonthValue(r.activity.date)))).sort();

  const filtered = rows.filter((r) => {
    if (sectionFilter !== "all" && sectionKey(r.program, sectionsById) !== sectionFilter) return false;
    if (monthFilter !== "all" && toMonthValue(r.activity.date) !== monthFilter) return false;
    return true;
  });

  const withLabels = filtered
    .map((r) => ({ ...r, ...rowLabels(r, sectionsById) }))
    .sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case "date":
          cmp = a.activity.date.getTime() - b.activity.date.getTime();
          break;
        case "section":
          cmp = a.sectionText.localeCompare(b.sectionText, "el");
          break;
        case "type":
          cmp = a.typeText.localeCompare(b.typeText, "el");
          break;
        case "location":
          cmp = (a.activity.location ?? "").localeCompare(b.activity.location ?? "", "el");
          break;
        case "status":
          cmp = a.statusText.localeCompare(b.statusText, "el");
          break;
      }
      return dir === "asc" ? cmp : -cmp;
    });

  function columnHref(column: HomeSortColumn): string {
    const nextDir: SortDir = sort === column && dir === "asc" ? "desc" : "asc";
    const params = new URLSearchParams({ section: sectionFilter, month: monthFilter, sort: column, dir: nextDir });
    return `/admin?${params.toString()}`;
  }

  return (
    <AdminLayout title="Αρχική" leader={leader} wide>
      <div class="programs-header">
        <h1>Όλες οι δράσεις</h1>
        <a class="button" href="/admin/programs">
          Προγράμματα
        </a>
      </div>

      <form method="get" action="/admin" class="home-filters">
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />

        {leader.role === "system_staff" && (
          <label>
            Τμήμα
            <select name="section" onchange="this.form.submit()">
              <option value="all" selected={sectionFilter === "all"}>
                Όλα τα τμήματα
              </option>
              <option value="system" selected={sectionFilter === "system"}>
                Σύστημα
              </option>
              {(["agele", "omada", "koinotita"] as const).map((type) => (
                <option value={type} selected={sectionFilter === type}>
                  {SECTION_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Μήνας
          <select name="month" onchange="this.form.submit()">
            <option value="all" selected={monthFilter === "all"}>
              Όλοι οι μήνες
            </option>
            {months.map((m) => (
              <option value={m} selected={monthFilter === m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </form>

      {withLabels.length === 0 ? (
        <p class="empty-state">Δεν υπάρχουν δράσεις με αυτά τα φίλτρα.</p>
      ) : (
        <div class="home-table-wrap">
          <table class="home-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th aria-sort={sort === col.key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                    <a href={columnHref(col.key)}>
                      {col.label}
                      {sort === col.key ? (dir === "asc" ? " ▲" : " ▼") : ""}
                    </a>
                  </th>
                ))}
                <th class="home-table-actions-header">Ενέργειες</th>
              </tr>
            </thead>
            <tbody>
              {withLabels.map((r) => (
                <ActivityRow row={r} sectionText={r.sectionText} typeText={r.typeText} statusText={r.statusText} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
