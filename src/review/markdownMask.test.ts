import { describe, expect, it } from "vitest";
import { LineIndex, maskMarkdown } from "./markdownMask";

describe("maskMarkdown", () => {
  it("preserves length so offsets map straight back to the source", () => {
    const source = "# Title\n\nSome `code` and [a link](http://example.com).\n";
    const mask = maskMarkdown(source);
    expect(mask.text).toHaveLength(source.length);
    expect(mask.ignored).toHaveLength(source.length);
  });

  it("keeps newlines so line numbers survive masking", () => {
    const source = "```js\nconst a = 1;\n```\nprose here.";
    const mask = maskMarkdown(source);
    expect(mask.text.split("\n")).toHaveLength(source.split("\n").length);
  });

  it("blanks fenced code but leaves the prose after it", () => {
    const source = "```\nnot prose at all\n```\nreal prose.";
    const mask = maskMarkdown(source);
    expect(mask.text).not.toContain("not prose");
    expect(mask.text).toContain("real prose.");
  });

  it("blanks inline code without moving the words around it", () => {
    const source = "Run `npm install` first.";
    const mask = maskMarkdown(source);
    expect(mask.text.indexOf("first")).toBe(source.indexOf("first"));
    expect(mask.text).not.toContain("npm install");
  });

  it("keeps link text and drops the URL", () => {
    const source = "See [the guide](https://example.com/very/long) now.";
    const mask = maskMarkdown(source);
    expect(mask.text).toContain("the guide");
    expect(mask.text).not.toContain("example.com");
  });

  it("strips heading and list markers but keeps their text", () => {
    const mask = maskMarkdown("## Heading\n- item one\n> quoted line\n");
    expect(mask.text).toContain("Heading");
    expect(mask.text).toContain("item one");
    expect(mask.text).toContain("quoted line");
    expect(mask.text).not.toContain("##");
    expect(mask.text).not.toContain("- item");
  });

  it("blanks YAML front matter", () => {
    const source = "---\ntitle: Draft\n---\n\nReal text.";
    const mask = maskMarkdown(source);
    expect(mask.text).not.toContain("title: Draft");
    expect(mask.text).toContain("Real text.");
  });

  it("marks each list item as a block start so they are separate sentences", () => {
    const source = "- first item\n- second item\n";
    const mask = maskMarkdown(source);
    expect(mask.blockStarts).toContain(source.indexOf("first"));
    expect(mask.blockStarts).toContain(source.indexOf("second"));
  });

});

describe("LineIndex", () => {
  const text = "one\ntwo\n\nfour";
  const index = new LineIndex(text);

  it("counts lines the way a document does", () => {
    expect(index.lineCount).toBe(4);
  });

  it("round-trips an offset through line and column", () => {
    const offset = text.indexOf("four");
    expect(index.lineAt(offset)).toBe(4);
    expect(index.columnAt(offset)).toBe(1);
    expect(index.lineStart(4)).toBe(offset);
  });

  it("bounds a line to its own text", () => {
    expect(text.slice(index.lineStart(2), index.lineEnd(2))).toBe("two");
    expect(text.slice(index.lineStart(3), index.lineEnd(3))).toBe("");
  });
});
