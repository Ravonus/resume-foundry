export type SummaryBlock = {
  type: "list" | "para";
  lines: string[];
};

const BULLET_PREFIX =
  /^\s*(?:[-*+]|[0-9]+\.|\u2022|\u2023|\u25E6|\u2043|\u2219|\u2013|\u2014)\s+/;

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

    if (BULLET_PREFIX.test(line)) {
      const content = line.replace(BULLET_PREFIX, "").trim();
      if (!content) continue;
      if (!current || current.type !== "list") {
        pushBlock(blocks, current);
        current = { type: "list", lines: [] };
      }
      current.lines.push(content);
      continue;
    }

    if (!current || current.type !== "para") {
      pushBlock(blocks, current);
      current = { type: "para", lines: [] };
    }
    current.lines.push(line);
  }

  pushBlock(blocks, current);
  return blocks;
};
