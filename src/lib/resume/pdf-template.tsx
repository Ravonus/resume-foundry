import {
  Document,
  Image,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { type ReactElement } from "react";

import {
  parseInlineMarkdown,
  parseSummaryBlocks,
  type InlineToken,
} from "~/lib/resume/summary-format";
import { type ResumeDraft } from "~/lib/resume/types";

type ResumePdfTheme = {
  accent: string;
  accentSoft: string;
  accentInk: string;
};

type SafeTheme = {
  accent: string;
  accentSoft: string;
  accentInk: string;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const resolveTheme = (theme: ResumePdfTheme): SafeTheme => {
  const accent = theme.accent?.trim() ?? "";
  const accentSoft = theme.accentSoft?.trim() ?? "";
  const accentInk = theme.accentInk?.trim() ?? "";
  return {
    accent: accent ? accent : "#1f5c7a",
    accentSoft: accentSoft ? accentSoft : "#d9e6ef",
    accentInk: accentInk ? accentInk : "#f6fbff",
  };
};

const isSafeHref = (value: string) => /^https?:\/\//i.test(value);

const isSafeImageSrc = (value: string) =>
  value.startsWith("data:image/") || isSafeHref(value);

const inlineTokensToHtml = (tokens: InlineToken[]) =>
  tokens
    .map((token) => {
      const content = escapeHtml(token.text);
      switch (token.type) {
        case "bold":
          return `<strong>${content}</strong>`;
        case "italic":
          return `<em>${content}</em>`;
        case "code":
          return `<code>${content}</code>`;
        case "link":
          return token.href && isSafeHref(token.href)
            ? `<a href="${escapeHtml(token.href)}">${content}</a>`
            : content;
        default:
          return content;
      }
    })
    .join("");

const formatSummaryHtml = (value: string) => {
  const blocks = parseSummaryBlocks(value);
  if (blocks.length === 0) return "";
  return blocks
    .map((block) => {
      if (block.type === "list") {
        const items = block.lines
          .map(
            (line) =>
              `<li>${inlineTokensToHtml(parseInlineMarkdown(line))}</li>`,
          )
          .join("");
        return `<ul>${items}</ul>`;
      }
      const content = block.lines
        .map((line) => inlineTokensToHtml(parseInlineMarkdown(line)))
        .join("<br/>");
      return `<p>${content}</p>`;
    })
    .join("");
};

type PdfStyles = ReturnType<typeof createPdfStyles>;

const createPdfStyles = (theme: SafeTheme) =>
  StyleSheet.create({
    page: {
      padding: 40,
      fontFamily: "Times-Roman",
      fontSize: 12,
      color: "#101418",
      lineHeight: 1.5,
      backgroundColor: "#ffffff",
    },
    header: {
      borderBottomWidth: 2,
      borderBottomColor: theme.accent,
      paddingBottom: 12,
      marginBottom: 16,
      flexDirection: "row",
    },
    headerBody: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      marginRight: 16,
    },
    name: {
      fontSize: 28,
      color: theme.accent,
      marginBottom: 4,
      fontFamily: "Times-Bold",
    },
    headline: {
      fontSize: 13.5,
      marginBottom: 8,
    },
    contact: {
      fontSize: 12,
      color: "#3d4a57",
      marginBottom: 12,
    },
    section: {
      marginBottom: 12,
    },
    h2: {
      fontSize: 12,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: theme.accent,
      borderBottomWidth: 1,
      borderBottomColor: theme.accent,
      paddingBottom: 4,
      marginBottom: 8,
      fontFamily: "Times-Bold",
    },
    h3: {
      fontSize: 12,
      marginBottom: 4,
      fontFamily: "Times-Bold",
    },
    paragraph: {
      marginBottom: 6,
      fontSize: 12.5,
    },
    meta: {
      fontSize: 11.5,
      color: "#5a6774",
      marginBottom: 6,
    },
    block: {
      marginBottom: 12,
    },
    list: {
      marginBottom: 8,
    },
    listItem: {
      flexDirection: "row",
      gap: 6,
      marginBottom: 4,
    },
    listBullet: {
      width: 10,
      fontSize: 12,
    },
    listText: {
      flexGrow: 1,
      fontSize: 12.5,
    },
    link: {
      color: theme.accentInk,
      textDecoration: "underline",
    },
    bold: {
      fontFamily: "Times-Bold",
    },
    italic: {
      fontFamily: "Times-Italic",
    },
    code: {
      fontFamily: "Courier",
      backgroundColor: "#f3f4f6",
      paddingHorizontal: 3,
      borderRadius: 3,
    },
    headshot: {
      width: 96,
      height: 96,
      borderRadius: 16,
      objectFit: "cover",
      borderWidth: 1,
      borderColor: "#d7dde5",
    },
  });

const renderInlineTokens = (
  tokens: InlineToken[],
  styles: PdfStyles,
  keyPrefix: string,
) =>
  tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "bold":
        return (
          <Text key={key} style={styles.bold}>
            {token.text}
          </Text>
        );
      case "italic":
        return (
          <Text key={key} style={styles.italic}>
            {token.text}
          </Text>
        );
      case "code":
        return (
          <Text key={key} style={styles.code}>
            {token.text}
          </Text>
        );
      case "link":
        if (token.href && isSafeHref(token.href)) {
          return (
            <Link key={key} src={token.href} style={styles.link}>
              {token.text}
            </Link>
          );
        }
        return <Text key={key}>{token.text}</Text>;
      default:
        return <Text key={key}>{token.text}</Text>;
    }
  });

const renderSummaryBlocks = (
  value: string,
  styles: PdfStyles,
  keyPrefix: string,
) => {
  const blocks = parseSummaryBlocks(value);
  if (blocks.length === 0) return [] as ReactElement[];

  return blocks.map((block, blockIndex) => {
    const blockKey = `${keyPrefix}-block-${blockIndex}`;
    if (block.type === "list") {
      return (
        <View key={blockKey} style={styles.list}>
          {block.lines.map((line, lineIndex) => (
            <View
              key={`${blockKey}-item-${lineIndex}`}
              style={styles.listItem}
            >
              <Text style={styles.listBullet}>•</Text>
              <Text style={styles.listText}>
                {renderInlineTokens(
                  parseInlineMarkdown(line),
                  styles,
                  `${blockKey}-item-${lineIndex}`,
                )}
              </Text>
            </View>
          ))}
        </View>
      );
    }

    return (
      <Text key={blockKey} style={styles.paragraph}>
        {block.lines.map((line, lineIndex) => (
          <Text key={`${blockKey}-line-${lineIndex}`}>
            {renderInlineTokens(
              parseInlineMarkdown(line),
              styles,
              `${blockKey}-line-${lineIndex}`,
            )}
            {lineIndex < block.lines.length - 1 ? "\n" : ""}
          </Text>
        ))}
      </Text>
    );
  });
};

const renderPlainList = (
  items: string[],
  styles: PdfStyles,
  keyPrefix: string,
) => (
  <View style={styles.list}>
    {items.map((item, index) => (
      <View key={`${keyPrefix}-${index}`} style={styles.listItem}>
        <Text style={styles.listBullet}>•</Text>
        <Text style={styles.listText}>{item}</Text>
      </View>
    ))}
  </View>
);

export const buildResumePdfDocument = (
  draft: ResumeDraft,
  theme: ResumePdfTheme,
) => {
  const safeTheme = resolveTheme(theme);
  const styles = createPdfStyles(safeTheme);
  const nameValue = draft.profile.fullName?.trim() ?? "";
  const headlineValue = draft.profile.headline?.trim() ?? "";
  const headshotValue = draft.profile.headshotUrl?.trim() ?? "";
  const name = nameValue ? nameValue : "Resume";
  const headline = headlineValue ? headlineValue : "";
  const headshot = headshotValue ? headshotValue : "";
  const contactParts = [
    draft.profile.email?.trim(),
    draft.profile.phone?.trim(),
    draft.profile.location?.trim(),
    draft.profile.website?.trim(),
    ...draft.links.map((link) => link.url?.trim()).filter(Boolean),
  ].filter(Boolean);

  const section = (
    title: string,
    body: ReactElement[] | ReactElement | null,
  ) =>
    body && (Array.isArray(body) ? body.length > 0 : true) ? (
      <View style={styles.section}>
        <Text style={styles.h2}>{title}</Text>
        {body}
      </View>
    ) : null;

  const summary = draft.profile.summary?.trim()
    ? renderSummaryBlocks(draft.profile.summary.trim(), styles, "summary")
    : [];

  const skills = draft.skills.length ? (
    <Text style={styles.paragraph}>{draft.skills.join(", ")}</Text>
  ) : null;

  const experiences = draft.experiences
    .filter((exp) => exp.title || exp.company)
    .map((exp, index) => {
      const title = [exp.title, exp.company].filter(Boolean).join(" - ");
      const metaParts = [
        [exp.startDate, exp.endDate].filter(Boolean).join(" - "),
        exp.location ?? "",
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      const meta = metaParts.length ? metaParts.join(" | ") : "";
      const summaryBlocks = exp.summary?.trim()
        ? renderSummaryBlocks(exp.summary.trim(), styles, `exp-${index}`)
        : [];
      const highlights = (exp.highlights ?? [])
        .map((value) => value.trim())
        .filter(Boolean);

      return (
        <View key={`exp-${index}`} style={styles.block}>
          <Text style={styles.h3}>{title}</Text>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {summaryBlocks}
          {highlights.length
            ? renderPlainList(highlights, styles, `exp-${index}-hl`)
            : null}
        </View>
      );
    });

  const education = draft.education
    .filter((edu) => edu.school)
    .map((edu, index) => {
      const title = [edu.school, edu.degree].filter(Boolean).join(" - ");
      const metaParts = [
        edu.field ?? "",
        [edu.startDate, edu.endDate].filter(Boolean).join(" - "),
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      const meta = metaParts.length ? metaParts.join(" | ") : "";
      const notes = edu.notes?.trim()
        ? edu.notes.trim()
        : "";

      return (
        <View key={`edu-${index}`} style={styles.block}>
          <Text style={styles.h3}>{title}</Text>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {notes ? <Text style={styles.paragraph}>{notes}</Text> : null}
        </View>
      );
    });

  const certifications = draft.certifications
    .filter((cert) => cert.name)
    .map((cert, index) => {
      const metaParts = [
        cert.issuer ?? "",
        cert.issueDate ? `Issued ${cert.issueDate}` : "",
        cert.expirationDate ? `Expires ${cert.expirationDate}` : "",
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      const meta = metaParts.length ? metaParts.join(" | ") : "";
      const credentialId = cert.credentialId?.trim()
        ? `Credential ID: ${cert.credentialId.trim()}`
        : "";
      const credentialUrl = cert.credentialUrl?.trim()
        ? cert.credentialUrl.trim()
        : "";

      return (
        <View key={`cert-${index}`} style={styles.block}>
          <Text style={styles.h3}>{cert.name}</Text>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {credentialId ? <Text style={styles.meta}>{credentialId}</Text> : null}
          {credentialUrl ? (
            <Text style={styles.meta}>{credentialUrl}</Text>
          ) : null}
        </View>
      );
    });

  const honors = draft.honors
    .filter((honor) => honor.title)
    .map((honor, index) => {
      const metaParts = [honor.issuer ?? "", honor.date ?? ""]
        .map((value) => value.trim())
        .filter(Boolean);
      const meta = metaParts.length ? metaParts.join(" | ") : "";
      const descriptionBlocks = honor.description?.trim()
        ? renderSummaryBlocks(
            honor.description.trim(),
            styles,
            `honor-${index}`,
          )
        : [];

      return (
        <View key={`honor-${index}`} style={styles.block}>
          <Text style={styles.h3}>{honor.title}</Text>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {descriptionBlocks}
        </View>
      );
    });

  const volunteering = draft.volunteering
    .filter((item) => item.role || item.organization)
    .map((item, index) => {
      const title = [item.role, item.organization]
        .filter(Boolean)
        .join(" - ");
      const metaParts = [
        item.cause ?? "",
        [item.startDate, item.endDate].filter(Boolean).join(" - "),
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      const meta = metaParts.length ? metaParts.join(" | ") : "";
      const summaryBlocks = item.summary?.trim()
        ? renderSummaryBlocks(
            item.summary.trim(),
            styles,
            `vol-${index}`,
          )
        : [];

      return (
        <View key={`vol-${index}`} style={styles.block}>
          <Text style={styles.h3}>{title}</Text>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {summaryBlocks}
        </View>
      );
    });

  const services = draft.services
    .filter((service) => service.name)
    .map((service, index) => {
      const descriptionBlocks = service.description?.trim()
        ? renderSummaryBlocks(
            service.description.trim(),
            styles,
            `service-${index}`,
          )
        : [];

      return (
        <View key={`service-${index}`} style={styles.block}>
          <Text style={styles.h3}>{service.name}</Text>
          {descriptionBlocks}
        </View>
      );
    });

  const headshotSrc = headshot && isSafeImageSrc(headshot) ? headshot : "";

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerBody}>
            <Text style={styles.name}>{name}</Text>
            {headline ? <Text style={styles.headline}>{headline}</Text> : null}
            {contactParts.length ? (
              <Text style={styles.contact}>{contactParts.join(" | ")}</Text>
            ) : null}
          </View>
          {headshotSrc ? <Image style={styles.headshot} src={headshotSrc} /> : null}
        </View>
        {section("Summary", summary)}
        {section("Skills", skills)}
        {section("Experience", experiences)}
        {section("Education", education)}
        {section("Certifications", certifications)}
        {section("Honors & Awards", honors)}
        {section("Volunteering", volunteering)}
        {section("Services", services)}
      </Page>
    </Document>
  );
};

export const buildResumePdfHtml = (
  draft: ResumeDraft,
  theme: ResumePdfTheme,
) => {
  const safeTheme = resolveTheme(theme);
  const nameValue = draft.profile.fullName?.trim() ?? "";
  const headlineValue = draft.profile.headline?.trim() ?? "";
  const headshotValue = draft.profile.headshotUrl?.trim() ?? "";
  const name = nameValue ? nameValue : "Resume";
  const headline = headlineValue ? headlineValue : "";
  const headshot = headshotValue ? headshotValue : "";
  const contactParts = [
    draft.profile.email?.trim(),
    draft.profile.phone?.trim(),
    draft.profile.location?.trim(),
    draft.profile.website?.trim(),
    ...draft.links.map((link) => link.url?.trim()).filter(Boolean),
  ].filter(Boolean);

  const section = (title: string, body: string) =>
    body ? `<section><h2>${title}</h2>${body}</section>` : "";

  const summary = draft.profile.summary?.trim()
    ? formatSummaryHtml(draft.profile.summary.trim())
    : "";

  const skills = draft.skills.length
    ? `<p>${draft.skills.join(", ")}</p>`
    : "";

  const experiences = draft.experiences
    .filter((exp) => exp.title || exp.company)
    .map((exp) => {
      const title = [exp.title, exp.company].filter(Boolean).join(" - ");
      const metaParts = [
        [exp.startDate, exp.endDate].filter(Boolean).join(" - "),
        exp.location ?? "",
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      const meta = metaParts.length
        ? `<div class="meta">${metaParts.join(" | ")}</div>`
        : "";
      const summaryText = exp.summary?.trim()
        ? formatSummaryHtml(exp.summary.trim())
        : "";
      const highlights = (exp.highlights ?? [])
        .filter((value) => value.trim())
        .map((value) => `<li>${value.trim()}</li>`)
        .join("");
      const highlightList = highlights ? `<ul>${highlights}</ul>` : "";
      return `<div class="block"><h3>${title}</h3>${meta}${summaryText}${highlightList}</div>`;
    })
    .join("");

  const education = draft.education
    .filter((edu) => edu.school)
    .map((edu) => {
      const title = [edu.school, edu.degree].filter(Boolean).join(" - ");
      const metaParts = [
        edu.field ?? "",
        [edu.startDate, edu.endDate].filter(Boolean).join(" - "),
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      const meta = metaParts.length
        ? `<div class="meta">${metaParts.join(" | ")}</div>`
        : "";
      const notes = edu.notes?.trim() ? `<p>${edu.notes.trim()}</p>` : "";
      return `<div class="block"><h3>${title}</h3>${meta}${notes}</div>`;
    })
    .join("");

  const certifications = draft.certifications
    .filter((cert) => cert.name)
    .map((cert) => {
      const metaParts = [
        cert.issuer ?? "",
        cert.issueDate ? `Issued ${cert.issueDate}` : "",
        cert.expirationDate ? `Expires ${cert.expirationDate}` : "",
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      const meta = metaParts.length
        ? `<div class="meta">${metaParts.join(" | ")}</div>`
        : "";
      const credentialId = cert.credentialId?.trim()
        ? `<div class="meta">Credential ID: ${cert.credentialId.trim()}</div>`
        : "";
      const credentialUrl = cert.credentialUrl?.trim()
        ? `<div class="meta">${cert.credentialUrl.trim()}</div>`
        : "";
      return `<div class="block"><h3>${cert.name}</h3>${meta}${credentialId}${credentialUrl}</div>`;
    })
    .join("");

  const honors = draft.honors
    .filter((honor) => honor.title)
    .map((honor) => {
      const metaParts = [honor.issuer ?? "", honor.date ?? ""]
        .map((value) => value.trim())
        .filter(Boolean);
      const meta = metaParts.length
        ? `<div class="meta">${metaParts.join(" | ")}</div>`
        : "";
      const description = honor.description?.trim()
        ? formatSummaryHtml(honor.description.trim())
        : "";
      return `<div class="block"><h3>${honor.title}</h3>${meta}${description}</div>`;
    })
    .join("");

  const volunteering = draft.volunteering
    .filter((item) => item.role || item.organization)
    .map((item) => {
      const title = [item.role, item.organization]
        .filter(Boolean)
        .join(" - ");
      const metaParts = [
        item.cause ?? "",
        [item.startDate, item.endDate].filter(Boolean).join(" - "),
      ]
        .map((value) => value.trim())
        .filter(Boolean);
      const meta = metaParts.length
        ? `<div class="meta">${metaParts.join(" | ")}</div>`
        : "";
      const summaryText = item.summary?.trim()
        ? formatSummaryHtml(item.summary.trim())
        : "";
      return `<div class="block"><h3>${title}</h3>${meta}${summaryText}</div>`;
    })
    .join("");

  const services = draft.services
    .filter((service) => service.name)
    .map((service) => {
      const description = service.description?.trim()
        ? formatSummaryHtml(service.description.trim())
        : "";
      return `<div class="block"><h3>${service.name}</h3>${description}</div>`;
    })
    .join("");

  const headshotHtml = headshot
    ? `<img class="headshot" src="${escapeHtml(headshot)}" alt="${escapeHtml(
        name,
      )} headshot" />`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(name)} Resume</title>
    <style>
      :root {
        color-scheme: light;
        --accent: ${safeTheme.accent};
        --accent-soft: ${safeTheme.accentSoft};
        --accent-ink: ${safeTheme.accentInk};
      }
      body {
        font-family: "IBM Plex Serif", "Times New Roman", serif;
        color: #101418;
        margin: 40px;
        line-height: 1.5;
        background: #ffffff;
      }
      h1 {
        font-size: 28px;
        margin: 0 0 4px;
        color: var(--accent);
      }
      h2 {
        font-size: 16px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin: 24px 0 8px;
        color: var(--accent);
        border-bottom: 1px solid var(--accent);
        padding-bottom: 4px;
      }
      h3 {
        font-size: 14px;
        margin: 12px 0 4px;
      }
      p, li {
        font-size: 12.5px;
        margin: 0 0 6px;
      }
      a {
        color: var(--accent-ink);
        text-decoration: underline;
      }
      code {
        font-family: "IBM Plex Mono", "Courier New", monospace;
        background: #f3f4f6;
        padding: 0 4px;
        border-radius: 4px;
      }
      ul {
        margin: 6px 0 12px 18px;
        padding: 0;
      }
      .meta {
        font-size: 11.5px;
        color: #5a6774;
        margin-bottom: 6px;
      }
      .block {
        margin-bottom: 12px;
      }
      .contact {
        font-size: 12px;
        color: #3d4a57;
        margin-bottom: 12px;
      }
      .headline {
        font-size: 13.5px;
        margin-bottom: 8px;
      }
      header {
        border-bottom: 2px solid var(--accent);
        padding-bottom: 12px;
        margin-bottom: 16px;
        display: flex;
        align-items: flex-start;
        gap: 16px;
      }
      .header-body {
        flex: 1;
        min-width: 0;
      }
      .headshot {
        width: 96px;
        height: 96px;
        border-radius: 16px;
        object-fit: cover;
        border: 1px solid #d7dde5;
      }
      @media print {
        body {
          margin: 24px;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="header-body">
        <h1>${escapeHtml(name)}</h1>
        ${headline ? `<div class="headline">${headline}</div>` : ""}
        ${contactParts.length ? `<div class="contact">${contactParts.join(" | ")}</div>` : ""}
      </div>
      ${headshotHtml}
    </header>
    ${section("Summary", summary)}
    ${section("Skills", skills)}
    ${section("Experience", experiences)}
    ${section("Education", education)}
    ${section("Certifications", certifications)}
    ${section("Honors & Awards", honors)}
    ${section("Volunteering", volunteering)}
    ${section("Services", services)}
  </body>
</html>`;
};
