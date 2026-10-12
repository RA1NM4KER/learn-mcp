// Preserve useful external links while hiding authenticated Moodle file URLs.
function decodeEntities(text: string): string {
  return text.replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|quot|apos|lt|gt|nbsp);/gi, (match, numeric: string | undefined, named: string | undefined) => {
    if (numeric) {
      const value = numeric[0]?.toLowerCase() === "x" ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }
    return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " } as Record<string, string>)[named?.toLowerCase() ?? ""] ?? match;
  });
}

/** Redact authored file links in text; actual retrieval still uses sealed fileIds. */
export function hideMoodleFileUrls(text: string): string {
  return text.replace(/(?:https?:\/\/[^\s<>"']*|\/[^\s<>"']*)?\/pluginfile\.php(?:[/?#][^\s<>"']*)?(?=$|[\s<>"'])/gi, "[Moodle file link hidden]");
}

export function stripHtml(html: string): string {
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attributes: string, body: string) => {
      const hrefMatch = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = decodeEntities(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "");
      const label = decodeEntities(body.replace(/<[^>]*>/g, "")).trim();
      if (!href || /\/pluginfile\.php(?:[/?#]|$)/i.test(href) || /^(?:javascript|data):/i.test(href)) {
        return label && !/\/pluginfile\.php(?:[/?#]|$)/i.test(label) ? label : "Link";
      }
      return label && label !== href ? `${label} (${href})` : href;
    })
    .replace(/<[^>]*>/g, "");
  return hideMoodleFileUrls(decodeEntities(text)).trim();
}

/** Truncate by Unicode code point, preserving surrogate pairs and signaling omission. */
export function truncateText(text: string, maxCharacters: number): string {
  let end = 0;
  let count = 0;
  for (const character of text) {
    if (count === maxCharacters) {
      return `${text.slice(0, end)}\n\n_[Text truncated after ${maxCharacters} characters.]_`;
    }
    end += character.length;
    count++;
  }
  return text;
}

export function sanitizeAndTruncateHtml(html: string, maxCharacters: number): string {
  return truncateText(stripHtml(html), maxCharacters);
}
