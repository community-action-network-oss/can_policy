// Offline HTML to text for legal-ingest (10-u42). Tags are dropped, entities decoded, nothing is reworded.
// ponytail: regex tag stripper, assumes no ">" inside attribute values; swap for a real parser if a source breaks it.
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const BLOCK = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|blockquote|pre)\b[^>]*>/gi;

export function htmlToText(html) {
  const s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(BLOCK, "\n")
    .replace(/<[^>]*>/g, "")
    // single pass, so "&amp;lt;" decodes once to "&lt;"
    .replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (m, d, h, n) => {
      if (n) return NAMED[n] ?? m;
      const cp = d ? Number(d) : parseInt(h, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    });
  // HTML whitespace rule: runs collapse to one space, empty lines vanish. Words are untouched.
  return s.split("\n").map((l) => l.replace(/[ \t\f\v ]+/g, " ").trim()).filter(Boolean).join("\n") + "\n";
}
