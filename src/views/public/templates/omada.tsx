import type { activities, programs, sections } from "../../../db/schema";
import { SECTION_VARIANTS, SectionSchedulePage } from "../layout";

type Props = {
  section: typeof sections.$inferSelect;
  program: typeof programs.$inferSelect | null;
  scheduleActivities: (typeof activities.$inferSelect)[];
  loginStatus?: string;
  loginError?: string;
  isLoggedIn?: boolean;
};

export function OmadaSectionPage(props: Props) {
  return <SectionSchedulePage {...props} variant={SECTION_VARIANTS.omada} />;
}
