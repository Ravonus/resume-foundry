import JSZip from "jszip";

import { type ResumeDraft } from "~/lib/resume/types";
import {
  parseInlineMarkdown,
  parseSummaryBlocks,
  type InlineToken,
} from "~/lib/resume/summary-format";
import {
  DEFAULT_RESUME_THEME,
  type ResumeTheme,
} from "~/server/services/resume-theme";

const HEADSHOT_SIZE_EMU = 1097280;
const SUPPORTED_IMAGE_TYPES = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
]);

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

type RunOptions = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

type RunSegment = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

type HeadshotAsset = {
  buffer: Buffer;
  extension: string;
  contentType: string;
};

const resolveImageExtension = (contentType: string) =>
  SUPPORTED_IMAGE_TYPES.get(contentType.toLowerCase()) ?? "";

const resolveExtensionFromUrl = (url: string) => {
  try {
    const path = new URL(url).pathname;
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg"].includes(extension)) {
      return extension === "jpeg" ? "jpg" : extension;
    }
  } catch {
    return "";
  }
  return "";
};

const parseDataUrlImage = (value: string): HeadshotAsset | null => {
  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(value);
  if (!match) return null;
  const rawContentType = match[1];
  const payload = match[2];
  if (!rawContentType || !payload) return null;
  const contentType = rawContentType.toLowerCase();
  const extension = resolveImageExtension(contentType);
  if (!extension) return null;
  try {
    const buffer = Buffer.from(payload, "base64");
    if (!buffer.length) return null;
    return { buffer, extension, contentType };
  } catch {
    return null;
  }
};

const fetchHeadshotImage = async (
  url: string,
): Promise<HeadshotAsset | null> => {
  const response = await fetch(url);
  if (!response.ok) return null;
  const rawContentType =
    response.headers.get("content-type")?.toLowerCase() ?? "";
  const contentType = rawContentType.split(";")[0]?.trim() ?? "";
  const extension =
    resolveImageExtension(contentType) || resolveExtensionFromUrl(url);
  if (!extension) return null;
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) return null;
  return {
    buffer,
    extension,
    contentType: resolveImageExtension(contentType)
      ? contentType
      : extension === "png"
        ? "image/png"
        : "image/jpeg",
  };
};

const resolveHeadshotAsset = async (
  headshotUrl: string,
): Promise<HeadshotAsset | null> => {
  if (!headshotUrl) return null;
  if (headshotUrl.startsWith("data:image/")) {
    return parseDataUrlImage(headshotUrl);
  }
  if (headshotUrl.startsWith("http://") || headshotUrl.startsWith("https://")) {
    try {
      return await fetchHeadshotImage(headshotUrl);
    } catch {
      return null;
    }
  }
  return null;
};

const buildParagraphProps = (options: ParagraphOptions) => {
  const pProps: string[] = [];
  if (options.spacingBefore || options.spacingAfter) {
    const before = options.spacingBefore ?? 0;
    const after = options.spacingAfter ?? 0;
    pProps.push(`<w:spacing w:before="${before}" w:after="${after}"/>`);
  }
  if (options.borderBottom) {
    const hex = options.borderBottom.replace("#", "").toUpperCase();
    pProps.push(
      `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${hex}"/></w:pBdr>`,
    );
  }
  return pProps.length > 0 ? `<w:pPr>${pProps.join("")}</w:pPr>` : "";
};

const buildRunXml = (
  text: string,
  options: ParagraphOptions,
  runOptions: RunOptions = {},
) => {
  const runProps: string[] = [];
  if (options.bold || runOptions.bold) runProps.push("<w:b/>");
  if (runOptions.italic) runProps.push("<w:i/>");
  if (runOptions.code) {
    runProps.push(
      '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>',
    );
  }
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

  return `<w:r>${runPropsXml}<w:t xml:space="preserve">${escapeXml(
    text,
  )}</w:t></w:r>`;
};

const paragraph = (text: string, options: ParagraphOptions = {}) => {
  if (!text) return "<w:p/>";
  const pPropsXml = buildParagraphProps(options);
  return `<w:p>${pPropsXml}${buildRunXml(text, options)}</w:p>`;
};

const paragraphRuns = (
  segments: RunSegment[],
  options: ParagraphOptions = {},
) => {
  if (segments.length === 0) return "<w:p/>";
  const runsXml = segments
    .filter((segment) => segment.text)
    .map((segment) =>
      buildRunXml(segment.text, options, {
        bold: segment.bold,
        italic: segment.italic,
        code: segment.code,
      }),
    )
    .join("");
  if (!runsXml) return "<w:p/>";
  const pPropsXml = buildParagraphProps(options);
  return `<w:p>${pPropsXml}${runsXml}</w:p>`;
};

const buildHeadshotParagraph = (relationshipId: string) => `\
<w:p>
  <w:pPr>
    <w:jc w:val="right"/>
    <w:spacing w:after="120"/>
  </w:pPr>
  <w:r>
    <w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="${HEADSHOT_SIZE_EMU}" cy="${HEADSHOT_SIZE_EMU}"/>
        <wp:docPr id="1" name="Headshot"/>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic>
              <pic:nvPicPr>
                <pic:cNvPr id="0" name="Headshot"/>
                <pic:cNvPicPr/>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="${relationshipId}"/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm>
                  <a:off x="0" y="0"/>
                  <a:ext cx="${HEADSHOT_SIZE_EMU}" cy="${HEADSHOT_SIZE_EMU}"/>
                </a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>`;

const buildDocumentXml = (
  draft: ResumeDraft,
  theme: ResumeTheme,
  headshotRelId?: string,
) => {
  const parts: string[] = [];

  const push = (text: string, options?: ParagraphOptions) => {
    parts.push(paragraph(text, options));
  };

  const pushBlank = () => parts.push(paragraph(""));
  const pushSummaryBlocks = (text: string, options?: ParagraphOptions) => {
    const blocks = parseSummaryBlocks(text);
    const toSegments = (tokens: InlineToken[]): RunSegment[] => {
      const segments: RunSegment[] = [];
      for (const token of tokens) {
        if (!token.text) continue;
        if (token.type === "link") {
          segments.push({ text: token.text });
          continue;
        }
        segments.push({
          text: token.text,
          bold: token.type === "bold" ? true : undefined,
          italic: token.type === "italic" ? true : undefined,
          code: token.type === "code" ? true : undefined,
        });
      }
      return segments;
    };

    const pushLine = (line: string) => {
      const segments = toSegments(parseInlineMarkdown(line));
      parts.push(paragraphRuns(segments, options));
    };

    for (const block of blocks) {
      if (block.type === "list") {
        for (const line of block.lines) {
          pushLine(`- ${line}`);
        }
        continue;
      }
      for (const line of block.lines) {
        pushLine(line);
      }
    }
  };

  if (headshotRelId) {
    parts.push(buildHeadshotParagraph(headshotRelId));
  }

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
      const highlights = (exp.highlights ?? []).filter((value) => value.trim());
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

  const certifications = draft.certifications.filter((item) => item.name);
  if (certifications.length > 0) {
    push("Certifications", {
      bold: true,
      size: 22,
      color: theme.accent,
      borderBottom: theme.accent,
      spacingBefore: 200,
      spacingAfter: 120,
    });
    for (const cert of certifications) {
      if (cert.name) push(cert.name, { bold: true, size: 21 });
      const metaParts = [
        cert.issuer ?? "",
        cert.issueDate ? `Issued ${cert.issueDate}` : "",
        cert.expirationDate ? `Expires ${cert.expirationDate}` : "",
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        push(metaParts.join(" | "), { size: 19 });
      }
      if (cert.credentialId?.trim()) {
        push(`Credential ID: ${cert.credentialId.trim()}`, { size: 19 });
      }
      if (cert.credentialUrl?.trim()) {
        push(cert.credentialUrl.trim(), { size: 19 });
      }
      pushBlank();
    }
  }

  const honors = draft.honors.filter((item) => item.title);
  if (honors.length > 0) {
    push("Honors & Awards", {
      bold: true,
      size: 22,
      color: theme.accent,
      borderBottom: theme.accent,
      spacingBefore: 200,
      spacingAfter: 120,
    });
    for (const honor of honors) {
      if (honor.title) push(honor.title, { bold: true, size: 21 });
      const metaParts = [honor.issuer ?? "", honor.date ?? ""]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        push(metaParts.join(" | "), { size: 19 });
      }
      if (honor.description?.trim()) {
        pushSummaryBlocks(honor.description.trim(), { size: 20 });
      }
      pushBlank();
    }
  }

  const volunteering = draft.volunteering.filter(
    (item) => item.role || item.organization,
  );
  if (volunteering.length > 0) {
    push("Volunteering", {
      bold: true,
      size: 22,
      color: theme.accent,
      borderBottom: theme.accent,
      spacingBefore: 200,
      spacingAfter: 120,
    });
    for (const item of volunteering) {
      const title = [item.role, item.organization].filter(Boolean).join(" - ");
      if (title) push(title, { bold: true, size: 21 });
      const metaParts = [
        item.cause ?? "",
        [item.startDate, item.endDate].filter(Boolean).join(" - "),
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      if (metaParts.length > 0) {
        push(metaParts.join(" | "), { size: 19 });
      }
      if (item.summary?.trim()) {
        pushSummaryBlocks(item.summary.trim(), { size: 20 });
      }
      pushBlank();
    }
  }

  const services = draft.services.filter((item) => item.name);
  if (services.length > 0) {
    push("Services", {
      bold: true,
      size: 22,
      color: theme.accent,
      borderBottom: theme.accent,
      spacingBefore: 200,
      spacingAfter: 120,
    });
    for (const service of services) {
      if (service.name) push(service.name, { bold: true, size: 21 });
      if (service.description?.trim()) {
        pushSummaryBlocks(service.description.trim(), { size: 20 });
      }
      pushBlank();
    }
  }

  const body = parts.join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
>
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
};

const buildStylesXml =
  () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>`;

const buildContentTypesXml = (imageExtension?: string) => {
  const imageContentType =
    imageExtension === "png"
      ? "image/png"
      : imageExtension === "jpg"
        ? "image/jpeg"
        : "";
  const imageDefault = imageContentType
    ? `  <Default Extension="${imageExtension}" ContentType="${imageContentType}"/>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
${imageDefault}  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
};

const buildRootRelsXml = () => `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const buildDocumentRelsXml = (
  imageName: string,
) => `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${imageName}"/>
</Relationships>`;

export const buildResumeDocx = async (
  draft: ResumeDraft,
  theme: ResumeTheme = DEFAULT_RESUME_THEME,
) => {
  const zip = new JSZip();
  const headshotUrl = draft.profile.headshotUrl?.trim() ?? "";
  const headshotAsset = headshotUrl
    ? await resolveHeadshotAsset(headshotUrl)
    : null;
  const imageName = headshotAsset ? `image1.${headshotAsset.extension}` : "";

  zip.file(
    "[Content_Types].xml",
    buildContentTypesXml(headshotAsset?.extension),
  );
  zip.folder("_rels")?.file(".rels", buildRootRelsXml());
  zip
    .folder("word")
    ?.file(
      "document.xml",
      buildDocumentXml(draft, theme, headshotAsset ? "rId1" : undefined),
    );
  zip.folder("word")?.file("styles.xml", buildStylesXml());
  if (headshotAsset && imageName) {
    zip.folder("word/media")?.file(imageName, headshotAsset.buffer);
    zip
      .folder("word/_rels")
      ?.file("document.xml.rels", buildDocumentRelsXml(imageName));
  }

  return zip.generateAsync({ type: "nodebuffer" });
};
