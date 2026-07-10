import type { activities, programs, sections } from "../../../db/schema";
import { SectionSchedulePage } from "../layout";

type Props = {
  section: typeof sections.$inferSelect;
  program: typeof programs.$inferSelect | null;
  scheduleActivities: (typeof activities.$inferSelect)[];
  loginStatus?: string;
  loginError?: string;
};

export function KoinotitaSectionPage(props: Props) {
  return (
    <SectionSchedulePage {...props} variant={{ type: "koinotita", accent: "#334155", bodyClass: "theme-koinotita" }} />
  );
}
