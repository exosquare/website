/**
 * Turn Mirage's objects and text into one decision.
 * The model is not asked to decide. These rules run in the page.
 *
 * Boxes are [x1, y1, x2, y2] on a 0 to 1000 scale.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_INDEX = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const FOOD = /\b(coffee|tea|sandwich|sandwiches|meal|meals|lunch|dinner|breakfast|burger|pizza|juice|cafe|café|food|drink|drinks|bread|cake|soup|noodle|noodles|rice)\b/i;
const MONEY = /(?:HK\$|US\$|A\$|NZ\$|S\$|C\$|£|€|₹|\$)\s*\d{1,6}(?:[.,]\d{2})?|\d{1,6}(?:[.,]\d{2})?\s*(?:HKD|USD|SGD|AUD|EUR|GBP|CAD|CHF|INR)\b/i;
const CURRENCY_WORD = /^(?:CHF|EUR|USD|GBP|HKD|CAD|AUD|SGD|INR)$/i;
const NON_LATIN = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Cyrillic}|\p{Script=Greek}|\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Thai}|\p{Script=Devanagari}/u;

/** Cups and paper this far outside the laptop box still count as in its frame. */
export const FRAME_MARGIN = 40;

/** Same floor as text_conf in the vision worker. A decision cannot rest on a weaker line. */
export const TEXT_CONFIDENCE = 0.15;

export function percent(score) {
  if (!Number.isFinite(score)) return 0;
  const value = score > 1 ? score : score * 100;
  const clamped = Math.max(0, Math.min(100, value));
  return Math.round(clamped * 10) / 10;
}

export function percentText(score) {
  return `${percent(score).toFixed(1)}%`;
}

export function readingOrder(items) {
  return [...items].sort((a, b) => {
    const rowA = Math.round((a.bbox?.[1] ?? 0) / 15);
    const rowB = Math.round((b.bbox?.[1] ?? 0) / 15);
    if (rowA !== rowB) return rowA - rowB;
    return (a.bbox?.[0] ?? 0) - (b.bbox?.[0] ?? 0);
  });
}

export function groupObjects(objects) {
  const groups = new Map();
  for (const object of objects) {
    const name = object.name || 'object';
    let group = groups.get(name);
    if (!group) {
      group = { name, count: 0, score: -1, bestId: object.id, items: [] };
      groups.set(name, group);
    }
    group.count += 1;
    group.items.push(object);
    if ((object.score ?? 0) >= group.score) {
      group.score = object.score ?? 0;
      group.bestId = object.id;
    }
  }
  return [...groups.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function boxOf(item) {
  const box = item?.bbox;
  if (!Array.isArray(box) || box.length < 4) return [0, 0, 0, 0];
  const x1 = Math.min(box[0], box[2]);
  const y1 = Math.min(box[1], box[3]);
  const x2 = Math.max(box[0], box[2]);
  const y2 = Math.max(box[1], box[3]);
  return [x1, y1, x2, y2];
}

function area(box) {
  return (Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1])) / 1e6;
}

function expand(box, margin) {
  return [
    Math.max(0, box[0] - margin),
    Math.max(0, box[1] - margin),
    Math.min(1000, box[2] + margin),
    Math.min(1000, box[3] + margin),
  ];
}

function intersects(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

function withIds(list, prefix) {
  return list.map((item, index) => ({
    ...item,
    id: item.id || `${prefix}-${index + 1}`,
    name: item.name || item.string || '',
    string: item.string || '',
    score: Number.isFinite(item.score) ? item.score : 0,
    bbox: boxOf(item),
  }));
}

function moneyIn(value) {
  const match = String(value).match(MONEY);
  if (!match) return null;
  return match[0].replace(/\s+/g, ' ').trim();
}

function currencyWord(value) {
  const cleaned = String(value).replace(/[^A-Za-z£€$₹]/g, '');
  if (CURRENCY_WORD.test(cleaned)) return cleaned.toUpperCase();
  if (/^[£€$₹]$/.test(cleaned)) return cleaned;
  return null;
}

function amountToken(value) {
  const match = String(value).match(/\d{1,4}[.,]\d{2}/);
  return match ? match[0] : null;
}

/** A printed total line often comes back as separate tokens on one row. */
function totalFromRow(lines) {
  const total = lines.find((line) => hasTotalWord(line.string));
  if (!total) return null;
  const row = lines.filter((line) => Math.abs(line.bbox[1] - total.bbox[1]) < 50);
  const inline = row.find((line) => moneyIn(line.string));
  if (inline) return { amount: moneyIn(inline.string), line: inline, total, currencyLine: null };
  const currencyLine = row.find((line) => currencyWord(line.string) && !amountToken(line.string) && !hasTotalWord(line.string));
  const amountLine = row.find((line) => amountToken(line.string));
  const currency = currencyLine ? currencyWord(currencyLine.string) : null;
  if (!currency || !amountLine) return null;
  const amount = amountToken(amountLine.string);
  const text = currency.length === 1 ? `${currency}${amount}` : `${currency} ${amount}`;
  return { amount: text, line: amountLine, total, currencyLine };
}

function hasTotalWord(value) {
  return /(?:^|[^a-z])total(?:[^a-z]|$)/i.test(value) || /total\s*hk\$/i.test(value);
}

function unitScore(score) {
  if (!Number.isFinite(score)) return 0;
  return score > 1 ? score / 100 : score;
}

function hasNonLatinLetter(value) {
  for (const char of String(value)) {
    if (/\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char)) return true;
  }
  return false;
}

/** Latin or digits, long enough to read, and at or above the confidence floor. */
export function readableLatin(line) {
  const value = String(line?.string || '');
  if (!value || hasNonLatinLetter(value)) return false;
  if (!/(?:\p{Script=Latin}|\d){2,}/u.test(value)) return false;
  return unitScore(line?.score) >= TEXT_CONFIDENCE;
}

function citedIds(item) {
  const ids = item?.ids ?? (item?.id ? [item.id] : []);
  return ids.filter(Boolean);
}

const PRICE_SHAPE = /\d+[.,]\s?\d{2}/;
const LIST_SCORE = 0.5;

function latinLetterCount(value) {
  return [...String(value)].filter((char) => /\p{Script=Latin}/u.test(char)).length;
}

/** An uncited line needs a real word or a price, and a score of at least 0.50. */
function listableUncited(line) {
  const value = String(line?.string || '');
  const shape = latinLetterCount(value) >= 3 || PRICE_SHAPE.test(value);
  return shape && unitScore(line?.score) >= LIST_SCORE;
}

/** Cited lines stay. Uncited lines have to pass the list filter. Order is preserved. */
export function shownText(lines, because) {
  const cited = new Set((because || []).flatMap((item) => citedIds(item)));
  return lines
    .filter((line) => cited.has(line.id) || listableUncited(line))
    .map((line) => ({ ...line, cited: cited.has(line.id) }));
}

export function plausibleLatinWord(value) {
  const words = String(value).match(/[A-Za-z]{4,}/g) || [];
  return words.some((word) => word === word.toUpperCase() || word === word.toLowerCase() || /^[A-Z][a-z]+$/.test(word));
}

function findDate(lines) {
  for (const line of lines) {
    const named = line.string.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{2,4})?/i);
    if (named) {
      const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
      if (month >= 0) return { label: `${Number(named[1])} ${MONTH_LABEL[month]}`, line };
    }
    const iso = line.string.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
      const month = Number(iso[2]) - 1;
      if (month >= 0 && month < 12) return { label: `${Number(iso[3])} ${MONTH_LABEL[month]}`, line };
    }
  }
  return null;
}

function clockParts(hourText, minuteText, meridiem) {
  if (!/^\d{1,2}$/.test(hourText)) return null;
  const hour = Number(hourText);
  let minute = 0;
  if (minuteText != null) {
    if (!/^\d{2}$/.test(minuteText) || Number(minuteText) > 59) return null;
    minute = Number(minuteText);
  }
  const mark = (meridiem || '').replace(/\./g, '').toLowerCase();
  if (mark && mark !== 'am' && mark !== 'pm') return null;
  if (mark) {
    if (hour < 1 || hour > 12) return null;
  } else if (hour > 23) return null;
  let h = hour;
  if (mark === 'pm' && h < 12) h += 12;
  if (mark === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  return h * 60 + minute;
}

function rangesInText(value) {
  const source = String(value);
  const pattern = /(^|\s)(\d{1,2})(?:([:.])(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|\bto\b)\s*(\d{1,2})(?:([:.])(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=$|\s)/gi;
  const found = [];
  let match = pattern.exec(source);
  while (match) {
    const prefix = match[1].length;
    const start = clockParts(match[2], match[4], match[5]);
    const end = clockParts(match[6], match[8], match[9]);
    const raw = match[0].slice(prefix);
    if (start != null && end != null && end > start && end - start <= 18 * 60) {
      found.push({
        start,
        end,
        raw: raw.replace(/\s+/g, ' ').trim(),
        index: match.index + prefix,
        length: raw.length,
      });
    }
    match = pattern.exec(source);
  }
  return found.filter((item, index, all) => !all.some((other, otherIndex) => (
    otherIndex !== index
    && other.index <= item.index
    && other.index + other.length >= item.index + item.length
    && other.length > item.length
  )));
}

function formatClock(minutes) {
  const wrapped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const suffix = h24 >= 12 ? 'pm' : 'am';
  let hour = h24 % 12;
  if (hour === 0) hour = 12;
  return minute ? `${hour}:${String(minute).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

const DAY_NAME = '(?:SUN|MON|TUE|WED|THU|FRI|SAT)(?:DAY)?';

function dayExpression(value) {
  const spans = rangesInText(value).sort((a, b) => b.index - a.index);
  let text = String(value);
  for (const span of spans) text = `${text.slice(0, span.index)} ${text.slice(span.index + span.length)}`;
  return text.replace(/\s+/g, ' ').trim();
}

function unresolvedClock(value) {
  const loose = /\d{1,2}(?:[:.]\d{1,2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|\/|\bto\b|\buntil\b)\s*\d{1,2}/i;
  return loose.test(String(value)) && rangesInText(value).length === 0;
}

function dayKey(token) {
  return DAY_INDEX[token.slice(0, 3)];
}

function dayRange(startToken, endToken) {
  const start = dayKey(startToken);
  const end = dayKey(endToken);
  const days = [];
  for (let step = 0; step < 7; step += 1) {
    const day = (start + step) % 7;
    days.push(day);
    if (day === end) break;
  }
  return days;
}

/** Days only when the whole expression is one supported schedule. A first match is not enough. */
function completeDays(expression) {
  const text = String(expression).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (/^(?:EVERY DAY|DAILY|ALL DAYS)$/.test(upper)) return [0, 1, 2, 3, 4, 5, 6];
  const range = upper.match(new RegExp(`^(${DAY_NAME})\\s*(?:-|–|—)\\s*(${DAY_NAME})$|^(${DAY_NAME})\\s+TO\\s+(${DAY_NAME})$`));
  if (range) return dayRange(range[1] || range[3], range[2] || range[4]);
  const single = upper.match(new RegExp(`^(${DAY_NAME})$`));
  if (single) return [dayKey(single[1])];
  return null;
}

function daySpan(days) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (days.length === 7) return 'every day';
  if (days.length === 1) return names[days[0]];
  const sorted = [...days].sort((a, b) => a - b);
  const sequential = sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
  if (sequential) return `${names[sorted[0]]} to ${names[sorted[sorted.length - 1]]}`;
  return sorted.map((day) => names[day]).join(', ');
}

function isCup(name) {
  return /\b(?:coffee\s+)?(?:cups?|mugs?)\b/i.test(name);
}

function isPaper(name) {
  return /\b(?:papers?|documents?|sheets?|notebooks?)\b/i.test(name);
}

function isLaptop(name) {
  return /\blaptops?\b/i.test(name);
}

function paperPhrase(name, count) {
  if (/^papers?$/i.test(name)) return count === 1 ? 'loose paper' : `${count} loose papers`;
  const noun = name.toLowerCase();
  if (count === 1) return noun === 'paper' ? 'loose paper' : `1 ${noun}`;
  const plural = noun.endsWith('s') ? noun : `${noun}s`;
  return `${count} ${plural}`;
}

function quote(value) {
  return `"${String(value).trim()}"`;
}

function result(kind, verdict, because, rule) {
  return { kind, verdict, because, rule };
}

function gate(decision, lines) {
  if (!decision) return decision;
  const byId = new Map(lines.map((line) => [line.id, line]));
  const weak = [];
  const seen = new Set();
  for (const item of decision.because || []) {
    for (const id of citedIds(item)) {
      const line = byId.get(id);
      if (!line || seen.has(line.id)) continue;
      if (unitScore(line.score) < TEXT_CONFIDENCE) {
        seen.add(line.id);
        weak.push(line);
      }
    }
  }
  if (!weak.length) return decision;
  return result(
    'unsure',
    "Can't tell.",
    [{
      text: weak.length === 1
        ? `${quote(weak[0].string)} is below the confidence threshold.`
        : `${weak.length} lines this rests on are below the confidence threshold.`,
      id: weak[0].id,
    }],
    'Page rule: a decision does not rest on a line below the confidence threshold.',
  );
}

function receiptDecision(lines) {
  const totalLines = lines.filter((line) => hasTotalWord(line.string));
  let amountLine = totalLines.find((line) => moneyIn(line.string));
  let amount = amountLine ? moneyIn(amountLine.string) : null;
  let quoted = amountLine;
  if (!amount) {
    for (const total of totalLines) {
      const near = lines.find((line) => moneyIn(line.string) && Math.abs(line.bbox[1] - total.bbox[1]) < 80);
      if (near) {
        amountLine = near;
        quoted = total;
        amount = moneyIn(near.string);
        break;
      }
    }
  }
  let currencyLine = null;
  if (!amount) {
    const joined = totalFromRow(lines);
    if (joined) {
      amount = joined.amount;
      amountLine = joined.line;
      quoted = joined.total;
      currencyLine = joined.currencyLine;
    }
  }
  if (!amount || !totalLines.length) return null;
  const foodLine = lines.find((line) => FOOD.test(line.string));
  const date = findDate(lines);
  const category = foodLine ? ' as food and drink' : '';
  const when = date ? date.label : 'date not found';
  const because = [
    {
      text: `Total line: ${quote(quoted.string === amountLine.string ? amountLine.string : `${quoted.string} ${amount}`)}`,
      id: quoted.id,
      ids: [quoted.id, currencyLine?.id, amountLine.id].filter(Boolean),
    },
    date
      ? { text: `Date line: ${quote(date.line.string)}`, id: date.line.id }
      : { text: 'No date line.', id: null },
  ];
  if (foodLine) because.push({ text: `Food and drink is named: ${quote(foodLine.string)}`, id: foodLine.id });
  return result(
    'receipt',
    `Log ${amount}${category}, ${when}.`,
    because.slice(0, 3),
    'Page rule: a receipt total becomes an expense entry.',
  );
}

const DAY_WORD = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|mo|di|mi|do|fr|sa|so|ma|wo|vr|za|zo)\b/i;

function dayLinesOf(lines) {
  return lines.filter((line) => DAY_WORD.test(line.string));
}

function isDiscLine(value) {
  return /^(?:max\s*2|2\s*h|2\s*u(?:ur)?|parkeerschijf|blauwe\s+zone)$/i.test(String(value).trim());
}

function clockShape(value) {
  return /\d{1,2}(?:[:.]\d{1,2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|\/|\bto\b|\buntil\b)\s*\d{1,2}/i.test(String(value));
}

/** A line is accepted only when every token is one day expression and at most one valid clock. */
function accountLine(line) {
  const raw = String(line.string).trim();
  if (!raw) return { line, disc: false, ranges: [], days: null, clean: true, unresolved: false };
  if (isDiscLine(raw)) return { line, disc: true, ranges: [], days: null, clean: true, unresolved: false };
  const ranges = rangesInText(line.string);
  const days = ranges.length <= 1 ? completeDays(dayExpression(line.string)) : null;
  const pureClock = ranges.length === 1 && dayExpression(line.string) === '';
  const pureDay = ranges.length === 0 && days !== null;
  const dayAndClock = ranges.length === 1 && days !== null;
  const clean = pureClock || pureDay || dayAndClock;
  const unresolved = !clean && (clockShape(raw) || ranges.length > 1 || (dayExpression(line.string) !== '' && days === null && ranges.length > 0));
  return {
    line,
    disc: false,
    ranges: clean ? ranges : ranges,
    days: clean ? days : null,
    clean,
    unresolved: unresolved || !clean,
  };
}

function distinctWindows(spans) {
  const windows = [];
  for (const span of spans) {
    if (!windows.some((item) => item.start === span.start && item.end === span.end)) windows.push(span);
  }
  return windows;
}

function unreadSchedule(citedLines) {
  const evidence = [...new Set(citedLines.map((line) => line.id).filter(Boolean))];
  return result(
    'unsure',
    "Can't tell.",
    [{
      text: "Day-specific hours were found, but I couldn't read them reliably. Check the sign before parking.",
      id: evidence[0] || null,
      ids: evidence,
    }],
    "Page rule: the sign's hours are compared with this device's clock.",
  );
}

function citedScheduleLines(lines, rows) {
  const extra = new Set(rows.filter((row) => row.ranges.length || !row.clean).map((row) => row.line.id));
  const days = dayLinesOf(lines);
  const rest = lines.filter((line) => extra.has(line.id) && !days.some((day) => day.id === line.id));
  return [...days, ...rest];
}

function parkingDecision(lines, now) {
  const rows = lines.map(accountLine);
  const spans = rows.filter((row) => row.clean).flatMap((row) => row.ranges.map((range) => ({ ...range, line: row.line })));
  const dayRows = rows.filter((row) => row.clean && row.days);
  const blocked = rows.some((row) => !row.clean);
  const disc = rows.some((row) => row.disc);
  const dayLines = dayLinesOf(lines);
  const looksLikeParking = Boolean(dayRows.length || spans.length || disc || blocked || dayLines.length || lines.some((line) => /\bparking\b/i.test(line.string)) || lines.some((line) => unresolvedClock(line.string)));
  if (!looksLikeParking) return null;
  const windows = distinctWindows(spans);
  const clockish = lines.some((line) => unresolvedClock(line.string) || clockShape(line.string));
  if (blocked || windows.length > 1 || dayRows.length > 1) {
    if (!windows.length && !clockish) {
      return result(
        'unsure',
        "Can't tell.",
        [{ text: 'No hours found. The sign does not show a start and end time.', id: dayLines[0]?.id || rows.find((row) => row.disc)?.line.id || null }],
        'Page rule: a decision needs a total, parking hours, or a laptop frame.',
      );
    }
    return unreadSchedule(citedScheduleLines(lines, rows));
  }
  if (!windows.length) {
    return result(
      'unsure',
      "Can't tell.",
      [{ text: 'No hours found. The sign does not show a start and end time.', id: dayLines[0]?.id || rows.find((row) => row.disc)?.line.id || null }],
      'Page rule: a decision needs a total, parking hours, or a laptop frame.',
    );
  }
  const range = windows[0];
  const rangeLine = range.line;
  const activeDays = dayRows.length ? dayRows[0].days : [0, 1, 2, 3, 4, 5, 6];
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  const openToday = activeDays.includes(today);
  const inside = openToday && nowMinutes >= range.start && nowMinutes < range.end;
  let verdict;
  if (disc && inside) verdict = `Should I park here now? Yes, for up to 2 hours with a parking disc, until ${formatClock(range.end)}.`;
  else if (disc) verdict = 'Should I park here now? Yes, no time limit now.';
  else if (dayLines.length && !openToday) verdict = `Should I park here now? Yes. Today is outside ${daySpan(activeDays)}.`;
  else if (inside) verdict = `Should I park here now? Not until ${formatClock(range.end)}.`;
  else if (nowMinutes < range.start) verdict = `Should I park here now? Yes, until ${formatClock(range.start)}.`;
  else verdict = `Should I park here now? Yes. The restriction ended at ${formatClock(range.end)}.`;
  const because = [{ text: `Hours on the sign: ${quote(rangeLine.string)}`, id: rangeLine.id }];
  if (disc) because.push({ text: 'Time limit on the sign: 2 hours with a parking disc.', id: disc.id });
  if (dayRows.length) {
    because.push({
      text: `Days on the sign: ${quote(dayRows[0].line.string)}`,
      id: dayRows[0].line.id,
      ids: [dayRows[0].line.id],
    });
  } else {
    because.push({ text: 'No day line. The hours are taken as every day.', id: null });
  }
  return result(
    'parking',
    verdict,
    because,
    "Page rule: the sign's hours are compared with this device's clock.",
  );
}

function deskDecision(objects) {
  const laptops = objects.filter((object) => isLaptop(object.name)).sort((a, b) => b.score - a.score);
  if (!laptops.length) return null;
  const laptop = laptops[0];
  const frame = expand(laptop.bbox, FRAME_MARGIN);
  const cups = objects.filter((object) => isCup(object.name) && intersects(object.bbox, frame));
  const papers = objects.filter((object) => isPaper(object.name) && intersects(object.bbox, frame));
  const cupCount = cups.length;
  const paperNames = new Map();
  for (const paper of papers) {
    const name = paper.name.toLowerCase();
    paperNames.set(name, (paperNames.get(name) || 0) + 1);
  }
  const paperText = [...paperNames.entries()].map(([name, count]) => paperPhrase(name, count)).join(' and ');
  const because = [{ text: `Laptop frame, ${percentText(laptop.score)}.`, id: laptop.id }];
  if (!cupCount && !papers.length) {
    because.push({ text: 'No cups or paper inside that frame.', id: laptop.id });
    return result(
      'desk',
      'Tidy up before a video call? No: the laptop frame is clear.',
      because,
      'Page rule: cups and paper in the laptop frame decide this.',
    );
  }
  if (cupCount) because.push({ text: `${cupCount} ${cupCount === 1 ? 'cup' : 'cups'} in that frame.`, id: cups[0].id });
  if (papers.length) because.push({ text: `${paperText} in that frame.`, id: papers[0].id });
  const parts = [];
  if (cupCount) parts.push(`${cupCount} ${cupCount === 1 ? 'cup' : 'cups'}`);
  if (papers.length) parts.push(paperText);
  const singular = cupCount + papers.length === 1;
  return result(
    'desk',
    `Tidy up before a video call? Yes: ${parts.join(' and ')} ${singular ? 'is' : 'are'} in shot.`,
    because.slice(0, 3),
    'Page rule: cups and paper in the laptop frame decide this.',
  );
}

function scriptDecision(lines) {
  const nonLatin = lines.find((line) => NON_LATIN.test(line.string));
  const readable = lines.some((line) => plausibleLatinWord(line.string));
  const unread = nonLatin || (lines.length >= 4 && !readable);
  if (!unread) return null;
  return result(
    'script',
    "Text found, but it isn't Latin script, so it couldn't be read.",
    [
      {
        text: lines.length === 1
          ? 'That line is not readable Latin.'
          : `${lines.length} text regions found; no readable Latin text identified.`,
        id: null,
      },
    ],
    'Page rule: text that is not Latin script is left unread.',
  );
}

function nothingDecision(objects, lines) {
  const meaningful = objects.filter((object) => area(object.bbox) <= 0.82);
  const textful = lines.some((line) => /[A-Za-z0-9\p{L}]/u.test(line.string));
  if (meaningful.length || textful) return null;
  return result(
    'empty',
    'Nothing recognisable found.',
    [{ text: 'No distinct object and no text line came back.', id: null }],
    'Page rule: with nothing recognised, there is no decision.',
  );
}

/**
 * @param {{ objects?: Array<Record<string, any>>, text?: Array<Record<string, any>> }} vision
 * @param {Date} [now] device-local clock
 * @returns {{ kind: string, verdict: string, because: Array<{ text: string, id: string | null, ids?: string[] }>, rule: string }}
 */
export function decide(vision, now = new Date()) {
  const objects = withIds(vision?.objects || [], 'object');
  const lines = readingOrder(withIds(vision?.text || [], 'text'));
  const receipt = receiptDecision(lines);
  if (receipt) return gate(receipt, lines);
  const parking = parkingDecision(lines, now);
  if (parking) return gate(parking, lines);
  const desk = deskDecision(objects);
  if (desk) return gate(desk, lines);
  const script = lines.length ? scriptDecision(lines) : null
  if (script) return gate(script, lines);

  const prices = lines.filter((line) => /\d+[.,]\d{2}/.test(line.string));
  const mentionsReceipt = lines.some((line) => /\breceipt\b/i.test(line.string));
  if (mentionsReceipt || prices.length >= 2 || lines.some((line) => hasTotalWord(line.string))) {
    return gate(result(
      'unsure',
      "Can't tell.",
      [
        { text: 'No total found. Try a sharper photo of the bottom of the receipt.', id: prices[0]?.id || lines[0]?.id || null },
        { text: 'A currency total is missing.', id: lines[0]?.id || null },
      ],
      'Page rule: a decision needs a total, parking hours, or a laptop frame.',
    ), lines);
  }
  if (lines.some((line) => /\bparking\b/i.test(line.string))) {
    return gate(result(
      'unsure',
      "Can't tell.",
      [
        { text: 'No hours found. The sign does not show a start and end time.', id: lines[0]?.id || null },
      ],
      'Page rule: a decision needs a total, parking hours, or a laptop frame.',
    ), lines);
  }
  const empty = nothingDecision(objects, lines);
  if (empty) return gate(empty, lines);
  return gate(result(
    'unsure',
    "Can't tell.",
    [{ text: 'No receipt total, parking hours, or laptop frame came back.', id: objects[0]?.id || lines[0]?.id || null }],
    'Page rule: a decision needs a total, parking hours, or a laptop frame.',
  ), lines);
}
