import type { activities, programs, sections } from "../../../db/schema";
import { SectionSchedulePage } from "../layout";

type Props = {
  section: typeof sections.$inferSelect;
  program: typeof programs.$inferSelect | null;
  scheduleActivities: (typeof activities.$inferSelect)[];
  loginStatus?: string;
  loginError?: string;
};

export function OmadaSectionPage(props: Props) {
  return (
    <SectionSchedulePage
      {...props}
      variant={{ type: "omada", accent: "#6b7d4f", heroEmoji: "🧭", bodyClass: "theme-omada" }}
    />
  );
}
