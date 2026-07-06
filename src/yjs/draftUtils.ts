export function generateDraftFromMarkdown(
  markdown: string,
  includeBody = true
): string {
  const lines = markdown.split("\n");

  if (!includeBody) {
    const outlineLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const title = match[2].trim();
        const indent = "  ".repeat(level - 1);
        outlineLines.push(`${indent}- ${title}`);
      }
    }
    return `# Outline\n${outlineLines.join("\n")}`;
  }

  const sections: { title: string; body: string[] }[] = [];
  let currentSection: { title: string; body: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        title: match[2].trim(),
        body: [],
      };
    } else if (currentSection && includeBody) {
      currentSection.body.push(line);
    }
  }
  if (currentSection) sections.push(currentSection);

  if (sections.length === 0) return "";

  return sections
    .map((sec) => `# ${sec.title}\n${sec.body.join("\n").trim()}`)
    .join("\n\n");
}

export function extractDraftNodes(draftMsg: string, documentId: string): any[] {
  const lines = draftMsg.split("\n");
  let currentSection: any = null;
  const nodes: any[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.*)/);
    if (match) {
      if (currentSection) nodes.push(currentSection);
      currentSection = {
        id: `${documentId}:sec-${i}`,
        document_id: documentId,
        level: match[1].length,
        title: match[2],
        notes: "",
      };
    } else if (currentSection && line.trim()) {
      currentSection.notes += line + "\n";
    }
  }
  if (currentSection) nodes.push(currentSection);
  return nodes;
}
