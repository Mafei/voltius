const PASTE_CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
const INVISIBLE_FORMAT_RE = /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;
// ZWNJ/ZWJ are kept inside words (Persian, Indic) and emoji sequences, stripped anywhere else.
const STRAY_JOINER_RE =
  /(?<![\p{L}\p{M}\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f])[\u200c\u200d]|[\u200c\u200d](?![\p{L}\p{M}\p{Extended_Pictographic}])/gu;

export function sanitizePasteText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(PASTE_CONTROL_RE, "")
    .replace(INVISIBLE_FORMAT_RE, "")
    .replace(STRAY_JOINER_RE, "");
}
