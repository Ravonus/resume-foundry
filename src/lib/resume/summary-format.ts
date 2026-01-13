export type SummaryBlock = {
  type: "list" | "para";
  lines: string[];
};

export type InlineToken = {
  type: "text" | "bold" | "italic" | "code" | "link";
  text: string;
  href?: string;
};

const BULLET_PREFIX =
  /^\s*(?:[-*+]|[0-9]+\.|\u2022|\u2023|\u25E6|\u2043|\u2219|\u2013|\u2014)\s+/;
const HEADING_PREFIX = /^\s*#{1,6}\s+/;
const QUOTE_PREFIX = /^\s*>\s?/;

const pushBlock = (
  blocks: SummaryBlock[],
  block: SummaryBlock | null,
) => {
  if (!block || block.lines.length === 0) return;
  blocks.push(block);
};

export const parseSummaryBlocks = (text: string): SummaryBlock[] => {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const blocks: SummaryBlock[] = [];
  let current: SummaryBlock | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pushBlock(blocks, current);
      current = null;
      continue;
    }

    const withoutHeading = line.replace(HEADING_PREFIX, "").trim();
    const withoutQuote = withoutHeading.replace(QUOTE_PREFIX, "").trim();

    if (BULLET_PREFIX.test(withoutQuote)) {
      const content = withoutQuote.replace(BULLET_PREFIX, "").trim();
      if (!content) continue;
      if (current?.type !== "list") {
        pushBlock(blocks, current);
        current = { type: "list", lines: [] };
      }
      current.lines.push(content);
      continue;
    }

    if (current?.type !== "para") {
      pushBlock(blocks, current);
      current = { type: "para", lines: [] };
    }
    current.lines.push(withoutQuote);
  }

  pushBlock(blocks, current);
  return blocks;
};

const mergeTextToken = (tokens: InlineToken[], text: string) => {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last?.type === "text") {
    last.text += text;
    return;
  }
  tokens.push({ type: "text", text });
};

export const parseInlineMarkdown = (text: string): InlineToken[] => {
  const tokens: InlineToken[] = [];
  if (!text) return tokens;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (!char) {
      index += 1;
      continue;
    }

    if (char === "[") {
      const closeLabel = text.indexOf("]", index + 1);
      const openUrl = closeLabel !== -1 ? text[closeLabel + 1] : "";
      const closeUrl =
        openUrl === "(" ? text.indexOf(")", closeLabel + 2) : -1;
      if (closeLabel !== -1 && openUrl === "(" && closeUrl !== -1) {
        const label = text.slice(index + 1, closeLabel);
        const href = text.slice(closeLabel + 2, closeUrl);
        if (label && href) {
          tokens.push({ type: "link", text: label, href });
          index = closeUrl + 1;
          continue;
        }
      }
    }

    if ((char === "*" || char === "_") && text[index + 1] === char) {
      const delimiter = char + char;
      const close = text.indexOf(delimiter, index + 2);
      if (close !== -1) {
        const content = text.slice(index + 2, close);
        if (content) {
          tokens.push({ type: "bold", text: content });
          index = close + 2;
          continue;
        }
      }
    }

    if (char === "*" || char === "_") {
      const close = text.indexOf(char, index + 1);
      if (close !== -1) {
        const content = text.slice(index + 1, close);
        if (content) {
          tokens.push({ type: "italic", text: content });
          index = close + 1;
          continue;
        }
      }
    }

    if (char === "`") {
      const close = text.indexOf("`", index + 1);
      if (close !== -1) {
        const content = text.slice(index + 1, close);
        if (content) {
          tokens.push({ type: "code", text: content });
          index = close + 1;
          continue;
        }
      }
    }

    mergeTextToken(tokens, char);
    index += 1;
  }

  return tokens;
};
