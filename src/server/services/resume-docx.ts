import JSZip from "jszip";

import { type ResumeDraft } from "~/lib/resume/types";
import { parseSummaryBlocks } from "~/lib/resume/summary-format";
import {
  DEFAULT_RESUME_THEME,
  type ResumeTheme,
} from "~/server/services/resume-theme";

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

type ParagraphOptions = {
  bold?: boolean;
  size?: number;
  color?: string;
  borderBottom?: string;
  spacingBefore?: number;
  spacingAfter?: number;
};

const paragraph = (text: string, options: ParagraphOptions = {}) => {
  if (!text) return "<w:p/>";
  const runProps: string[] = [];
  if (options.bold) runProps.push("<w:b/>");
  if (options.size) {
    runProps.push(`<w:sz w:val="${options.size}"/>`);
    runProps.push(`<w:szCs w:val="${options.size}"/>`);
  }
  if (options.color) {
    const hex = options.color.replace("#", "").toUpperCase();
    runProps.push(`<w:color w:val="${hex}"/>`);
  }
  const runPropsXml =
    runProps.length > 0 ? `<w:rPr>${runProps.join("")}</w:rPr>` : "";

  const pProps: string[] = [];
  if (options.spacingBefore || options.spacingAfter) {
    const before = options.spacingBefore ?? 0;
    const after = options.spacingAfter ?? 0;
    pProps.push(
      `<w:spacing w:before="${before}" w:after="${after}"/>`,
    );
  }
  if (options.borderBottom) {
    const hex = options.borderBottom.replace("#", "").toUpperCase();
    pProps.push(
      `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${hex}"/></w:pBdr>`,
    );
  }
  const pPropsXml = pProps.length > 0 ? `<w:pPr>${pProps.join("")}</w:pPr>` : "";

  return `<w:p>${pPropsXml}<w:r>${runPropsXml}<w:t xml:space="preserve">${escapeXml(
    text,
  )}</w:t></w:r></w:p>`;
};

const buildDocumentXml = (draft: ResumeDraft, theme: ResumeTheme) => {
  const parts: string[] = [];

  const push = (text: string, options?: ParagraphOptions) => {
    parts.push(paragraph(text, options));
  };

  const pushBlank = () => parts.push(paragraph(""));
  const pushSummaryBlocks = (text: string, options?: ParagraphOptions) => {
    const blocks = parseSummaryBlocks(text);
    for (const block of blocks) {
      if (block.type === "list") {
        for (const line of block.lines) {
          push(`- ${line}`, options);
        }
        continue;
      }
      for (const line of block.lines) {
        push(line, options);
      }
    }
  };

  const profile = draft.profile;
  const name = profile.fullName?.trim() ?? "";
  if (name) push(name, { bold: true, size: 36, color: theme.accent });
  const headline = profile.headline?.trim() ?? "";
  if (headline) push(headline, { size: 24 });

  const contactParts = [
    profile.email?.trim(),
    profile.phone?.trim(),
    profile.location?.trim(),
    profile.website?.trim(),
    ...draft.links.map((link) => link.url?.trim()).filter(Boolean),
  ].filter(Boolean) as string[];

  if (contactParts.length > 0) {
    push(contactParts.join(" | "), { size: 20 });
  }

  if (name || headline || contactParts.length > 0) {
    pushBlank();
  }

  const summary = profile.summary?.trim() ?? "";
  if (summary) {
    push("Summary", {
      bold: true,
      size: 22,
      color: theme.accent,
      borderBottom: theme.accent,
      spacingBefore: 200,
      spacingAfter: 120,
    });
    pushSummaryBlocks(summary, { size: 20 });
    pushBlank();
  }

  if (draft.skills.length > 0) {
    push("Skills", {
      bold: true,
      size: 22,
      color: theme.accent,
      borderBottom: theme.accent,
      spacingBefore: 200,
      spacingAfter: 120,
    });
    push(draft.skills.join(", "), { size: 20 });
    pushBlank();
  }

  const experiences = draft.experiences.filter(
    (item) => item.title || item.company,
  );
  if (experiences.length > 0) {
    push("Experience", {
      bold: true,
      size: 22,
      color: theme.accent,
      borderBottom: theme.accent,
      spacingBefore: 200,
      spacingAfter: 120,
    });
    for (const exp of experiences) {
      const titleCompany = [exp.title, exp.company].filter(Boolean).join(" - ");
      if (titleCompany) push(titleCompany, { bold: true, size: 21 });
      const metaParts = [
        [exp.startDate, exp.endDate].filter(Boolean).join(" - "),
        exp.location ?? "",
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        push(metaParts.join(" | "), { size: 19 });
      }
      if (exp.summary?.trim()) {
        pushSummaryBlocks(exp.summary.trim(), { size: 20 });
      }
      const highlights = (exp.highlights ?? []).filter((value) =>
        value.trim(),
      );
      for (const highlight of highlights) {
        push(`- ${highlight.trim()}`, { size: 20 });
      }
      pushBlank();
    }
  }

  const education = draft.education.filter((item) => item.school);
  if (education.length > 0) {
    push("Education", {
      bold: true,
      size: 22,
      color: theme.accent,
      borderBottom: theme.accent,
      spacingBefore: 200,
      spacingAfter: 120,
    });
    for (const edu of education) {
      const title = [edu.school, edu.degree].filter(Boolean).join(" - ");
      if (title) push(title, { bold: true, size: 21 });
      const metaParts = [
        edu.field ?? "",
        [edu.startDate, edu.endDate].filter(Boolean).join(" - "),
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        push(metaParts.join(" | "), { size: 19 });
      }
      if (edu.notes?.trim()) {
        push(edu.notes.trim(), { size: 20 });
      }
      pushBlank();
    }
  }

  const body = parts.join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
};

const buildStylesXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>`;

const buildContentTypesXml = () => `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const buildRootRelsXml = () => `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export const buildResumeDocx = async (
  draft: ResumeDraft,
  theme: ResumeTheme = DEFAULT_RESUME_THEME,
) => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", buildContentTypesXml());
  zip.folder("_rels")?.file(".rels", buildRootRelsXml());
  zip.folder("word")?.file("document.xml", buildDocumentXml(draft, theme));
  zip.folder("word")?.file("styles.xml", buildStylesXml());

  return zip.generateAsync({ type: "nodebuffer" });
};
