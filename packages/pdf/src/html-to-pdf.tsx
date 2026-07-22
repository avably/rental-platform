import React from "react";
import { Link as PdfLink, Text, View } from "@react-pdf/renderer";

// ══════════════════════════════════════════════════════════════════════════
//  Konwerter HTML → react-pdf dla treści warunków najmu (`terms.body`).
//  Obsługuje: p, h2, h3, strong, b, em, i, u, a, ul, ol, li, br, hr.
//  Funkcje czyste — bez I/O, bez dat, bez zależności od środowiska.
//  Szablon prowadzi warunki jednym ciągiem, który @react-pdf stronicuje sam.
// ══════════════════════════════════════════════════════════════════════════

type PdfStyle = Record<string, string | number>;

interface AstNode {
  type: "text" | "element";
  tag?: string;
  attrs?: Record<string, string>;
  children?: AstNode[];
  text?: string;
}

const VOID_TAGS = new Set(["br", "hr", "img"]);

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

// ── Prosty tokenizer/parser HTML ──────────────────────────────────────────

function parseHtml(html: string): AstNode[] {
  const nodes: AstNode[] = [];
  let pos = 0;

  while (pos < html.length) {
    const tagStart = html.indexOf("<", pos);
    if (tagStart === -1) {
      const text = decodeEntities(html.slice(pos));
      if (text.trim()) nodes.push({ type: "text", text });
      break;
    }

    // Tekst przed znacznikiem
    if (tagStart > pos) {
      const text = decodeEntities(html.slice(pos, tagStart));
      if (text) nodes.push({ type: "text", text });
    }

    const tagEnd = html.indexOf(">", tagStart);
    if (tagEnd === -1) {
      nodes.push({ type: "text", text: html.slice(tagStart) });
      break;
    }

    const tagContent = html.slice(tagStart + 1, tagEnd).trim();
    pos = tagEnd + 1;

    // Znacznik zamykający — obsługiwany przez rekurencję rodzica
    if (tagContent.startsWith("/")) {
      return nodes;
    }

    const selfClosing = tagContent.endsWith("/");
    const cleanContent = selfClosing ? tagContent.slice(0, -1).trim() : tagContent;

    const spaceIdx = cleanContent.indexOf(" ");
    const tagName = (spaceIdx === -1 ? cleanContent : cleanContent.slice(0, spaceIdx)).toLowerCase();
    const attrString = spaceIdx === -1 ? "" : cleanContent.slice(spaceIdx);
    const attrs: Record<string, string> = {};

    const attrRegex = /(\w[\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(attrString)) !== null) {
      const name = match[1];
      if (!name) continue;
      attrs[name] = match[2] ?? match[3] ?? match[4] ?? "";
    }

    if (selfClosing || VOID_TAGS.has(tagName)) {
      nodes.push({ type: "element", tag: tagName, attrs, children: [] });
      continue;
    }

    const { children, newPos } = parseChildrenUntilClose(html, pos, tagName);
    nodes.push({ type: "element", tag: tagName, attrs, children });
    pos = newPos;
  }

  return nodes;
}

function parseChildrenUntilClose(
  html: string,
  startPos: number,
  parentTag: string,
): { children: AstNode[]; newPos: number } {
  const pos = startPos;
  let depth = 1;

  const closeTag = `</${parentTag}>`;
  let searchPos = pos;

  while (searchPos < html.length) {
    const nextOpen = html.indexOf(`<${parentTag}`, searchPos);
    const nextClose = html.indexOf(closeTag, searchPos);

    if (nextClose === -1) break;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      searchPos = nextOpen + parentTag.length + 1;
      continue;
    }

    depth--;
    if (depth === 0) {
      const innerHtml = html.slice(pos, nextClose);
      return { children: parseHtml(innerHtml), newPos: nextClose + closeTag.length };
    }

    searchPos = nextClose + closeTag.length;
  }

  return { children: parseHtml(html.slice(pos)), newPos: html.length };
}

// ── AST → elementy react-pdf ──────────────────────────────────────────────

const BASE_FONT_SIZE = 8;
const LINE_HEIGHT = 1.5;
const MUTED = "#55616D";
const BORDER = "#7E8994";
const SIGNAL_STRONG = "#5F7500";

const blockStyles: Record<string, PdfStyle> = {
  p: { marginBottom: 4, fontSize: BASE_FONT_SIZE, lineHeight: LINE_HEIGHT, textAlign: "justify" },
  h2: { fontSize: 10, fontWeight: 700, marginBottom: 4, marginTop: 8 },
  h3: { fontSize: 9, fontWeight: 700, marginBottom: 3, marginTop: 6 },
};

const inlineStyles: Record<string, PdfStyle> = {
  strong: { fontWeight: 700 },
  b: { fontWeight: 700 },
  em: { fontStyle: "italic" },
  i: { fontStyle: "italic" },
  u: { textDecoration: "underline" },
};

function renderAstNode(
  node: AstNode,
  key: string,
  insideText = false,
): React.ReactElement | string | null {
  if (node.type === "text") {
    const text = node.text ?? "";
    if (!text) return null;
    if (insideText) return text;
    if (text.trim()) {
      return (
        <Text key={key} style={{ fontSize: BASE_FONT_SIZE, lineHeight: LINE_HEIGHT }}>
          {text}
        </Text>
      );
    }
    return null;
  }

  const tag = node.tag ?? "";
  const inlineStyle = inlineStyles[tag];
  const blockStyle = blockStyles[tag];
  const isInline = !!inlineStyle || tag === "a";
  const children = (node.children ?? [])
    .map((child, i) => renderAstNode(child, `${key}-${i}`, insideText || isInline))
    .filter(Boolean);

  if (tag === "hr") {
    return (
      <View
        key={key}
        style={{ borderBottomWidth: 0.5, borderBottomColor: BORDER, marginVertical: 4 }}
      />
    );
  }

  if (inlineStyle) {
    return (
      <Text key={key} style={inlineStyle}>
        {children}
      </Text>
    );
  }

  if (tag === "a") {
    const href = node.attrs?.href ?? "";
    return (
      <PdfLink key={key} src={href} style={{ color: SIGNAL_STRONG, textDecoration: "underline" }}>
        {children.length > 0 ? children : href}
      </PdfLink>
    );
  }

  if (tag === "br") {
    return insideText ? <Text key={key}>{"\n"}</Text> : null;
  }

  if (tag === "ul" || tag === "ol") {
    let listItemCounter = 0;
    return (
      <View key={key} style={{ marginBottom: 4, marginTop: 2 }}>
        {(node.children ?? []).map((child, i) => {
          if (child.type === "element" && child.tag === "li") {
            listItemCounter++;
            const bullet = tag === "ol" ? `${listItemCounter}.` : "•";
            const liChildren = (child.children ?? [])
              .map((c, j) => renderAstNode(c, `${key}-li-${i}-${j}`, true))
              .filter(Boolean);
            return (
              <View
                key={`${key}-li-${i}`}
                wrap={false}
                style={{ flexDirection: "row", marginBottom: 2, paddingLeft: 4 }}
              >
                <Text style={{ fontSize: BASE_FONT_SIZE, width: tag === "ol" ? 14 : 8, color: MUTED }}>
                  {bullet}
                </Text>
                <Text style={{ fontSize: BASE_FONT_SIZE, lineHeight: LINE_HEIGHT, flex: 1 }}>
                  {liChildren}
                </Text>
              </View>
            );
          }
          // Whitespace między <li> psułby numerację — pomijamy
          if (child.type === "text" && !(child.text ?? "").trim()) return null;
          return renderAstNode(child, `${key}-${i}`, false);
        })}
      </View>
    );
  }

  if (blockStyle) {
    if (tag === "p" || tag === "h2" || tag === "h3") {
      const textChildren = (node.children ?? [])
        .map((c, i) => renderAstNode(c, `${key}-t-${i}`, true))
        .filter(Boolean);
      return (
        <Text key={key} style={blockStyle}>
          {textChildren}
        </Text>
      );
    }
    return (
      <View key={key} style={blockStyle}>
        {children}
      </View>
    );
  }

  if (children.length > 0) {
    if (insideText) return <Text key={key}>{children}</Text>;
    return <View key={key}>{children}</View>;
  }

  return null;
}

// ── Publiczny komponent ────────────────────────────────────────────────────

export function HtmlContent({
  html,
  style,
}: {
  html: string;
  style?: PdfStyle;
}): React.ReactElement {
  if (!html || !html.trim()) {
    return (
      <View style={style}>
        <Text style={{ fontSize: BASE_FONT_SIZE, color: MUTED }}>—</Text>
      </View>
    );
  }

  const elements = parseHtml(html)
    .map((node, i) => renderAstNode(node, `root-${i}`))
    .filter(Boolean);

  return <View style={style}>{elements}</View>;
}

/**
 * Czy string wygląda jak HTML (wyjście edytora), czy jak zwykły tekst.
 */
export function looksLikeHtml(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}
