/*
 * Command palette matching (overlays.md D): names, slot numbers ("64"), block codes ("dly") and the gear a
 * model is based on ("mesa"). Every query word must match somewhere; the item's score is the mean of its
 * word scores. Ranges point into `primary` so the palette can bold matched characters.
 */

export interface Searchable {
  /** The item's name, shown and highlighted */
  primary: string;
  /** Other text that matches but isn't highlighted in the name: block code, origin, type, hint */
  secondary?: readonly string[];
  /** Preset slot number; a numeric word equal to it is the strongest match */
  slot?: number;
}

export type Range = readonly [start: number, end: number];

export interface Match {
  score: number;
  ranges: Range[];
}

const isWordChar = (c: string | undefined) => c !== undefined && /[a-z0-9]/i.test(c);

/** Score of `word` (lowercase) inside `text`: prefix > word start > substring; -1 when absent. */
function substringScore(text: string, word: string, prefix: number, wordStart: number, inner: number): { score: number; at: number } {
  const lower = text.toLowerCase();
  let at = lower.indexOf(word);
  if (at < 0) return { score: -1, at };
  if (at === 0) return { score: prefix, at };
  // Prefer a later occurrence that starts a word ("dual" in "Rector Dual V").
  for (let i = at; i >= 0; i = lower.indexOf(word, i + 1)) {
    if (!isWordChar(lower[i - 1])) return { score: wordStart, at: i };
  }
  return { score: inner, at };
}

/**
 * Characters of `word` in order inside `text`, as ranges, where every run starts a word ("shgt" in
 * "Shatte-GT1"); null otherwise, so stray letters ("rec…t" in "Reconnect") don't match.
 */
function subsequence(text: string, word: string): Range[] | null {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  let from = 0;
  for (const ch of word) {
    const last = ranges[ranges.length - 1];
    if (last && lower[last[1]] === ch) {
      last[1]++;
      from = last[1];
      continue;
    }
    let i = lower.indexOf(ch, from);
    while (i >= 0 && isWordChar(lower[i - 1])) i = lower.indexOf(ch, i + 1);
    if (i < 0) return null;
    ranges.push([i, i + 1]);
    from = i + 1;
  }
  return ranges;
}

function matchWord(word: string, item: Searchable): { score: number; ranges: Range[] } | null {
  if (/^\d{1,2}$/.test(word) && item.slot !== undefined && Number(word) === item.slot) return { score: 1000, ranges: [] };
  const p = substringScore(item.primary, word, 900, 700, 500);
  if (p.score > 0) return { score: p.score, ranges: [[p.at, p.at + word.length]] };
  let best = -1;
  for (const s of item.secondary ?? []) {
    if (s.toLowerCase() === word) best = Math.max(best, 450);
    else best = Math.max(best, substringScore(s, word, 350, 350, 250).score);
  }
  if (best > 0) return { score: best, ranges: [] };
  if (word.length >= 2) {
    const ranges = subsequence(item.primary, word);
    if (ranges) {
      const spread = ranges[ranges.length - 1][1] - ranges[0][0] - word.length;
      return { score: Math.max(10, 150 - spread * 10 - ranges.length * 5), ranges };
    }
  }
  return null;
}

/** Match `query` against one item; null when any word is missing. An empty query matches everything with score 0. */
export function matchItem(query: string, item: Searchable): Match | null {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, ranges: [] };
  let total = 0;
  const ranges: Range[] = [];
  for (const w of words) {
    const m = matchWord(w, item);
    if (!m) return null;
    total += m.score;
    ranges.push(...m.ranges);
  }
  // Shorter names win ties ("Rector Dual V" before "Rector Dual V Crunch").
  return { score: total / words.length - item.primary.length * 0.01, ranges: mergeRanges(ranges) };
}

export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Items matching `query`, best first (stable for equal scores), at most `limit`. */
export function rank<T>(query: string, items: readonly T[], toSearchable: (item: T) => Searchable, limit = Infinity): { item: T; match: Match }[] {
  const hits: { item: T; match: Match; i: number }[] = [];
  items.forEach((item, i) => {
    const match = matchItem(query, toSearchable(item));
    if (match) hits.push({ item, match, i });
  });
  hits.sort((a, b) => b.match.score - a.match.score || a.i - b.i);
  return hits.slice(0, limit).map(({ item, match }) => ({ item, match }));
}

/** Split `text` into plain and matched parts for rendering. */
export function splitByRanges(text: string, ranges: readonly Range[]): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) parts.push({ text: text.slice(pos, s), hit: false });
    parts.push({ text: text.slice(s, e), hit: true });
    pos = e;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), hit: false });
  return parts;
}
