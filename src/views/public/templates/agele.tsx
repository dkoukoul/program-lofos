import type { activities, programs, sections } from "../../../db/schema";
import { SectionSchedulePage } from "../layout";

type Props = {
  section: typeof sections.$inferSelect;
  program: typeof programs.$inferSelect | null;
  scheduleActivities: (typeof activities.$inferSelect)[];
  loginStatus?: string;
  loginError?: string;
};

export function AgeleSectionPage(props: Props) {
  return (
    <SectionSchedulePage
      {...props}
      variant={{ type: "agele", accent: "#f59e0b", heroEmoji: "🐺", bodyClass: "theme-agele" }}
    />
  );
}
