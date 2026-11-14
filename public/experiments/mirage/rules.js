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

export function percent(score) {
  if (!Number.isFinite(score)) return 0;
  const value = score > 1 ? score : score * 100;
  return Math.max(0, Math.min(100, Math.round(value)));
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
  if (inline) return { amount: moneyIn(inline.string), line: inline, total };
  const currency = row.map((line) => currencyWord(line.string)).find(Boolean);
  const amountLine = row.find((line) => amountToken(line.string));
  if (!currency || !amountLine) return null;
  const amount = amountToken(amountLine.string);
  const text = currency.length === 1 ? `${currency}${amount}` : `${currency} ${amount}`;
  return { amount: text, line: amountLine, total };
}

function hasTotalWord(value) {
  return /(?:^|[^a-z])total(?:[^a-z]|$)/i.test(value) || /total\s*hk\$/i.test(value);
}

function plausibleLatinWord(value) {
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

function parseRange(value) {
  const match = String(value).match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|\bto\b)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
  if (!match) return null;
  const startHour = Number(match[1]);
  const endHour = Number(match[4]);
  let start = clockToMinutes(startHour, match[2], match[3], endHour, match[6], 'start');
  let end = clockToMinutes(endHour, match[5], match[6], startHour, match[3], 'end');
  if (end <= start) end += 12 * 60;
  if (end <= start || end - start > 18 * 60) return null;
  return { start, end, raw: match[0].replace(/\s+/g, ' ').trim() };
}

function clockToMinutes(hour, minuteText, meridiem, otherHour, otherMeridiem, role) {
  let h = hour;
  const minute = minuteText ? Number(minuteText) : 0;
  const mark = (meridiem || '').replace(/\./g, '').toLowerCase();
  const other = (otherMeridiem || '').replace(/\./g, '').toLowerCase();
  if (mark === 'pm' && h < 12) h += 12;
  if (mark === 'am' && h === 12) h = 0;
  if (!mark) {
    if (h >= 13) return h * 60 + minute;
    if (role === 'end' && (other === 'am' || (!other && otherHour > hour))) h += h === 12 ? 0 : 12;
    if (role === 'start' && other === 'pm' && hour > otherHour) h = hour;
    if (role === 'end' && other === 'pm' && hour <= otherHour) h += h === 12 ? 0 : 12;
    if (role === 'end' && !other && otherHour <= hour && hour <= 12 && otherHour >= 13) {
      /* 24h already handled */
    }
  }
  if (h === 24) h = 0;
  return h * 60 + minute;
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

function parseDays(lines) {
  const blob = lines.map((line) => line.string).join(' ');
  const compact = blob.toUpperCase().replace(/[^A-Z]/g, '');
  if (/EVERYDAY|DAILY|ALLDAYS/.test(compact)) return [0, 1, 2, 3, 4, 5, 6];
  const range = blob.toUpperCase().match(/\b(SUN|MON|TUE|WED|THU|FRI|SAT)(?:DAY)?\s*(?:-|–|—|TO)+\s*(SUN|MON|TUE|WED|THU|FRI|SAT)/);
  if (range) {
    const start = DAY_INDEX[range[1]];
    const end = DAY_INDEX[range[2]];
    const days = [];
    for (let step = 0; step < 7; step += 1) {
      const day = (start + step) % 7;
      days.push(day);
      if (day === end) break;
    }
    return days;
  }
  const found = [...blob.toUpperCase().matchAll(/\b(SUN|MON|TUE|WED|THU|FRI|SAT)(?:DAY)?\b/g)].map((match) => DAY_INDEX[match[1]]);
  return [...new Set(found)];
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
  if (!amount) {
    const joined = totalFromRow(lines);
    if (joined) {
      amount = joined.amount;
      amountLine = joined.line;
      quoted = joined.total;
    }
  }
  if (!amount || !totalLines.length) return null;
  const foodLine = lines.find((line) => FOOD.test(line.string));
  const date = findDate(lines);
  const category = foodLine ? ' as food and drink' : '';
  const when = date ? date.label : 'date not found';
  const because = [
    { text: `Total line: ${quote(quoted.string === amountLine.string ? amountLine.string : `${quoted.string} ${amount}`)}`, id: quoted.id },
    date
      ? { text: `Date line: ${quote(date.line.string)}`, id: date.line.id }
      : { text: 'No date line.', id: totalLines[0].id },
  ];
  if (foodLine) because.push({ text: `Food and drink is named: ${quote(foodLine.string)}`, id: foodLine.id });
  return result(
    'receipt',
    `Log ${amount}${category}, ${when}.`,
    because.slice(0, 3),
    'Page rule: a receipt total becomes an expense entry.',
  );
}

function parkingDecision(lines, now) {
  const rangeLine = lines.find((line) => parseRange(line.string));
  if (!rangeLine) return null;
  const range = parseRange(rangeLine.string);
  const days = parseDays(lines);
  const activeDays = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
  const dayLine = lines.find((line) => /\b(mon|tue|wed|thu|fri|sat|sun|daily|every day)\b/i.test(line.string));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  const openToday = activeDays.includes(today);
  const inside = openToday && nowMinutes >= range.start && nowMinutes < range.end;
  let verdict;
  if (!openToday) verdict = `Should I park here now? Yes. Today is outside ${daySpan(activeDays)}.`;
  else if (inside) verdict = `Should I park here now? Not until ${formatClock(range.end)}.`;
  else if (nowMinutes < range.start) verdict = `Should I park here now? Yes, until ${formatClock(range.start)}.`;
  else verdict = `Should I park here now? Yes. The restriction ended at ${formatClock(range.end)}.`;
  const because = [{ text: `Hours on the sign: ${quote(rangeLine.string)}`, id: rangeLine.id }];
  if (dayLine) because.push({ text: `Days on the sign: ${quote(dayLine.string)}`, id: dayLine.id });
  else because.push({ text: 'No day line. The hours are taken as every day.', id: rangeLine.id });
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
  const because = [{ text: `Laptop frame, ${percent(laptop.score)}%.`, id: laptop.id }];
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

function scriptDecision(lines, objects) {
  const nonLatin = lines.find((line) => NON_LATIN.test(line.string));
  const readable = lines.some((line) => plausibleLatinWord(line.string));
  const unread = nonLatin || (lines.length >= 4 && !readable);
  if (!unread) return null;
  const anchor = nonLatin || lines[0] || objects.find((object) => /text/i.test(object.name));
  return result(
    'script',
    "Can't tell.",
    [
      { text: "Text found, but it isn't Latin script, so it wasn't read.", id: anchor?.id ?? null },
      {
        text: lines.length === 1
          ? 'That line is not readable Latin.'
          : `${lines.length} lines are marked, and none of them is readable Latin.`,
        id: lines[1]?.id || anchor?.id || null,
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
 * @returns {{ kind: string, verdict: string, because: Array<{ text: string, id: string | null }>, rule: string }}
 */
export function decide(vision, now = new Date()) {
  const objects = withIds(vision?.objects || [], 'object');
  const lines = readingOrder(withIds(vision?.text || [], 'text'));
  const receipt = receiptDecision(lines);
  if (receipt) return receipt;
  const parking = parkingDecision(lines, now);
  if (parking) return parking;
  const desk = deskDecision(objects);
  if (desk) return desk;
  const script = lines.length ? scriptDecision(lines, objects) : null;
  if (script) return script;

  const prices = lines.filter((line) => /\d+[.,]\d{2}/.test(line.string));
  const mentionsReceipt = lines.some((line) => /\breceipt\b/i.test(line.string));
  if (mentionsReceipt || prices.length >= 2 || lines.some((line) => hasTotalWord(line.string))) {
    return result(
      'unsure',
      "Can't tell.",
      [
        { text: 'No total found. Try a sharper photo of the bottom of the receipt.', id: prices[0]?.id || lines[0]?.id || null },
        { text: 'A currency total is missing.', id: lines[0]?.id || null },
      ],
      'Page rule: a decision needs a total, parking hours, or a laptop frame.',
    );
  }
  if (lines.some((line) => /\bparking\b/i.test(line.string))) {
    return result(
      'unsure',
      "Can't tell.",
      [
        { text: 'No hours found. The sign does not show a start and end time.', id: lines[0]?.id || null },
      ],
      'Page rule: a decision needs a total, parking hours, or a laptop frame.',
    );
  }
  const empty = nothingDecision(objects, lines);
  if (empty) return empty;
  return result(
    'unsure',
    "Can't tell.",
    [{ text: 'No receipt total, parking hours, or laptop frame came back.', id: objects[0]?.id || lines[0]?.id || null }],
    'Page rule: a decision needs a total, parking hours, or a laptop frame.',
  );
}
