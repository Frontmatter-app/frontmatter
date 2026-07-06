import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

export const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

export type MarkdownReferences = Record<string, { href: string; title: string }>;

export function normalizeMarkdownUrl(rawUrl: string) {
  const normalized = markdown.normalizeLink(rawUrl.trim());
  return markdown.validateLink(normalized) ? normalized : '';
}

function getInlineChildren(raw: string, references: MarkdownReferences = {}) {
  const tokens = markdown.parseInline(raw, { references });
  const inlineToken = tokens.find(token => token.type === 'inline');
  return inlineToken?.children ?? [];
}

function getAttr(token: Token, name: string) {
  return token.attrGet(name) ?? '';
}

export function collectMarkdownReferences(markdownSource: string) {
  const env: { references?: MarkdownReferences } = {};
  markdown.parse(markdownSource, env);
  return env.references ?? {};
}

export function parseMarkdownLinkToken(raw: string, references: MarkdownReferences = {}) {
  const linkToken = getInlineChildren(raw, references).find(token => token.type === 'link_open');
  if (!linkToken) return null;

  const href = getAttr(linkToken, 'href');
  if (!href) return null;

  return {
    url: href,
    title: getAttr(linkToken, 'title') || undefined,
  };
}

export function parseMarkdownImageToken(raw: string, references: MarkdownReferences = {}) {
  const imageToken = getInlineChildren(raw, references).find(token => token.type === 'image');
  if (!imageToken) return null;

  const src = getAttr(imageToken, 'src');
  if (!src) return null;

  return {
    alt: imageToken.content,
    url: src,
    title: getAttr(imageToken, 'title') || undefined,
  };
}
