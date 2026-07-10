import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// Τμήματα: Αγέλη / Ομάδα / Κοινότητα — πάντα ακριβώς 3 εγγραφές (§4 architecture doc)
export const sections = sqliteTable("sections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["agele", "omada", "koinotita"] }).notNull().unique(),
  name: text("name").notNull(),
  themeColor: text("theme_color"),
  logoPath: text("logo_path"),
  icalPublicToken: text("ical_public_token").notNull().unique(),
});

// Βαθμοφόροι τμήματος + επιτελείο Συστήματος
export const leaders = sqliteTable("leaders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["section_leader", "system_staff"] }).notNull(),
  sectionId: integer("section_id").references(() => sections.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const magicLinks = sqliteTable("magic_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leaderId: integer("leader_id").notNull().references(() => leaders.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leaderId: integer("leader_id").notNull().references(() => leaders.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  userAgent: text("user_agent"),
});

// Περίοδος προγράμματος (π.χ. μήνας ή custom εύρος ημερομηνιών).
// sectionId = null σημαίνει "system πρόγραμμα": container για Δράσεις Συστήματος
// που αφορούν όλα τα τμήματα ταυτόχρονα (βλ. docs/decisions.md).
export const programs = sqliteTable("programs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sectionId: integer("section_id").references(() => sections.id),
  periodStart: integer("period_start", { mode: "timestamp" }).notNull(),
  periodEnd: integer("period_end", { mode: "timestamp" }).notNull(),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  themeColorOverride: text("theme_color_override"),
  themeImagePath: text("theme_image_path"),
  themeTitle: text("theme_title"),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const activities = sqliteTable("activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  programId: integer("program_id").notNull().references(() => programs.id),
  isSystemWide: integer("is_system_wide", { mode: "boolean" }).notNull().default(false),
  type: text("type", {
    enum: ["typical", "day_trip", "multi_day", "other", "no_activity"],
  }).notNull(),
  // Η ημέρα που "καταλαμβάνει" η δράση (χρησιμοποιείται για τον έλεγχο επικάλυψης
  // §6 architecture doc, και ως το μόνο υποχρεωτικό πεδίο για type="no_activity").
  date: integer("date", { mode: "timestamp" }).notNull(),
  location: text("location"),
  startsAt: integer("starts_at", { mode: "timestamp" }),
  endsAt: integer("ends_at", { mode: "timestamp" }),
  cost: text("cost"),
  whatToBring: text("what_to_bring"),
  changedAfterPublishFields: text("changed_after_publish_fields", { mode: "json" }).$type<string[]>(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const activityCustomFields = sqliteTable("activity_custom_fields", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  activityId: integer("activity_id").notNull().references(() => activities.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
});

export const activityParticipants = sqliteTable(
  "activity_participants",
  {
    activityId: integer("activity_id").notNull().references(() => activities.id),
    leaderId: integer("leader_id").notNull().references(() => leaders.id),
  },
  (table) => [primaryKey({ columns: [table.activityId, table.leaderId] })],
);
