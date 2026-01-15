import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { type ReactElement } from "react";
import { buildResumePdfDocument } from "~/lib/resume/pdf-template";

import { type ResumeDraft } from "~/lib/resume/types";
import { type ResumeTheme } from "~/server/services/resume-theme";

export const buildResumePdf = async (
  draft: ResumeDraft,
  theme: ResumeTheme,
) => {
  const document: ReactElement<DocumentProps> = buildResumePdfDocument(
    draft,
    theme,
  );
  return renderToBuffer(document);
};
