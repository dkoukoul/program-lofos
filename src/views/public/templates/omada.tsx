import type { programs, sections } from "../../../db/schema";
import type { DetailedActivity } from "../../../lib/notes";
import { SECTION_VARIANTS, SectionSchedulePage } from "../layout";

type Props = {
  section: typeof sections.$inferSelect;
  program: Pick<typeof programs.$inferSelect, "periodStart" | "periodEnd" | "themeTitle"> | null;
  scheduleActivities: DetailedActivity[];
  loginStatus?: string;
  loginError?: string;
  isLoggedIn?: boolean;
  previewBanner?: unknown;
};

export function OmadaSectionPage(props: Props) {
  return <SectionSchedulePage {...props} variant={SECTION_VARIANTS.omada} />;
}
