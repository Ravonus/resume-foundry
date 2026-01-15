import { renderToBuffer } from "@react-pdf/renderer";

import { buildResumePdfDocument } from "~/lib/resume/pdf-template";
import { type ResumeDraft } from "~/lib/resume/types";
import { type ResumeTheme } from "~/server/services/resume-theme";

export const buildResumePdf = async (
  draft: ResumeDraft,
  theme: ResumeTheme,
) => {
  const document = buildResumePdfDocument(draft, theme);
  return renderToBuffer(document);
};
