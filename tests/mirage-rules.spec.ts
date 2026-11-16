import { test, expect } from '@playwright/test';
import { decide, groupObjects, percent, percentText, readingOrder, shownText } from '../public/experiments/mirage/rules.js';
import { boxStagger, linesDue, scanState } from '../public/experiments/mirage/motion.js';

const fridayAfternoon = new Date(2026, 10, 13, 15, 0, 0);
const fridayMorning = new Date(2026, 10, 13, 7, 0, 0);
const fridayEvening = new Date(2026, 10, 13, 19, 30, 0);
const saturday = new Date(2026, 10, 14, 12, 0, 0);

const parking = {
  text: [
    { id: 'sign', string: 'NO PARKING', bbox: [20, 18, 80, 26], score: 0.66 },
    { id: 'hours', string: '8 AM- 7 PM', bbox: [17, 33, 66, 40], score: 0.67 },
    { id: 'days', string: 'MON -FRI', bbox: [21, 48, 63, 56], score: 0.65 },
  ],
};

test('a receipt total and a currency become an expense entry', () => {
  const decision = decide({
    text: [
      { id: 'coffee', string: 'Coffee', bbox: [20, 16, 40, 20], score: 0.8 },
      { id: 'total', string: 'TOTALHK$186.50', bbox: [19, 32, 79, 37], score: 0.63 },
      { id: 'date', string: '14 Nov 2026', bbox: [20, 38, 45, 42], score: 0.88 },
    ],
  }, fridayAfternoon);
  expect(decision.verdict).toBe('Log HK$186.50 as food and drink, 14 Nov.');
  expect(decision.rule).toBe('Page rule: a receipt total becomes an expense entry.');
  expect(decision.because.map((line) => line.id)).toEqual(['total', 'date', 'coffee']);
});

test('a total, a currency word, and an amount on one row are joined', () => {
  const decision = decide({
    text: [
      { id: 'total', string: 'Total:', bbox: [20, 440, 40, 480], score: 0.7 },
      { id: 'cur', string: 'CHF', bbox: [48, 440, 58, 480], score: 0.7 },
      { id: 'amt', string: '54.50', bbox: [64, 440, 84, 480], score: 0.8 },
    ],
  }, fridayAfternoon);
  expect(decision.kind).toBe('receipt');
  expect(decision.verdict).toBe('Log CHF 54.50, date not found.');
  expect(decision.because[0].text).toBe('Total line: "Total: CHF 54.50"');
});

test('a weak amount on the total row is not logged', () => {
  const decision = decide({
    text: [
      { id: 'total', string: 'Total:', bbox: [20, 440, 40, 480], score: 0.9 },
      { id: 'cur', string: 'CHF', bbox: [48, 440, 58, 480], score: 0.9 },
      { id: 'amt', string: '54.50', bbox: [64, 440, 84, 480], score: 0.05 },
    ],
  }, fridayAfternoon);
  expect(decision.verdict).toBe("Can't tell.");
  expect(decision.because[0].text).toBe('"54.50" is below the confidence threshold.');
});

test('a receipt without a date says date not found', () => {
  const decision = decide({
    text: [
      { id: 'tea', string: 'Tea', bbox: [10, 10, 30, 20], score: 0.7 },
      { id: 'total', string: 'TOTAL $12.00', bbox: [10, 30, 40, 40], score: 0.8 },
    ],
  }, fridayAfternoon);
  expect(decision.verdict).toBe('Log $12.00 as food and drink, date not found.');
  expect(decision.because.find((line) => line.text === 'No date line.')?.id).toBeNull();
});

const discSign = {
  text: [
    { id: 'disc', string: '2h', bbox: [20, 18, 40, 26], score: 0.5 },
    { id: 'hours', string: '8 AM- 7 PM', bbox: [17, 33, 66, 40], score: 0.67 },
  ],
};

test('a disc zone allows two hours inside the signed hours', () => {
  const inside = decide(discSign, fridayAfternoon);
  expect(inside.verdict).toBe('Should I park here now? Yes, for up to 2 hours with a parking disc, until 7pm.');
  expect(inside.because.map((line) => line.text)).toContain('Time limit on the sign: 2 hours with a parking disc.');
  expect(inside.because.find((line) => line.text.startsWith('No day line'))?.id).toBeNull();
});

test('a disc zone has no time limit outside the signed hours', () => {
  expect(decide(discSign, fridayEvening).verdict).toBe('Should I park here now? Yes, no time limit now.');
});

test('parking hours without a duration are unchanged', () => {
  const decision = decide(parking, fridayAfternoon);
  expect(decision.verdict).toBe('Should I park here now? Not until 7pm.');
  expect(decision.because.some((line) => line.text.startsWith('Duration'))).toBe(false);
});

test('unreadable day lines are not a parking permission', () => {
  const sign = {
    text: [
      { id: 'd1', string: 'Ma.t/m Vr.', bbox: [10, 10, 80, 24], score: 0.6 },
      { id: 'short', string: '09.00-18.00', bbox: [10, 30, 80, 44], score: 0.8 },
      { id: 'long', string: '09.00-21.00', bbox: [10, 50, 80, 64], score: 0.8 },
      { id: 'd2', string: 'Za.', bbox: [10, 70, 40, 84], score: 0.7 },
    ],
  };
  for (const [hour, minute] of [[7, 30], [10, 30], [19, 0], [22, 0]]) {
    const when = new Date(2026, 10, 13, hour, minute, 0);
    const decision = decide(sign, when);
    expect(decision.verdict).toBe("Can't tell.");
    expect(decision.because.map((line) => line.text)).toEqual([
      "Day-specific hours were found, but I couldn't read them reliably. Check the sign before parking.",
    ]);
    expect(decision.because[0].ids).toEqual(['d1', 'd2', 'short', 'long']);
  }
});

const mondayMorning = new Date(2026, 10, 16, 10, 0, 0);
const UNREAD_DAYS = "Day-specific hours were found, but I couldn't read them reliably. Check the sign before parking.";

function pair(id: string, string: string, top: number) {
  return { id, string, bbox: [10, top, 90, top + 16], score: 0.9 };
}

test('two day-and-hour lines are not flattened into one permission', () => {
  const sign = {
    text: [
      pair('tue', 'TUE 08:00–09:00', 10),
      pair('mon', 'MON 09:00–18:00', 40),
    ],
  };
  const decision = decide(sign, mondayMorning);
  expect(decision.verdict).toBe("Can't tell.");
  expect(decision.because.map((line) => line.text)).toEqual([UNREAD_DAYS]);
  expect(decision.because[0].ids).toEqual(['tue', 'mon']);
  const reversed = decide({
    text: [
      pair('mon', 'MON 09:00–18:00', 10),
      pair('tue', 'TUE 08:00–09:00', 40),
    ],
  }, mondayMorning);
  expect(reversed.verdict).toBe("Can't tell.");
  expect(reversed.because[0].text).toBe(UNREAD_DAYS);
  expect(reversed.because[0].ids).toEqual(['mon', 'tue']);
  const weekend = decide({
    text: [
      pair('sat', 'SAT 10:00-12:00', 10),
      pair('sun', 'SUN 14:00-16:00', 40),
    ],
  }, mondayMorning);
  expect(weekend.verdict).toBe("Can't tell.");
  expect(weekend.because[0].ids).toEqual(['sat', 'sun']);
  const splitMonday = decide({
    text: [
      pair('am', 'MON 09:00-12:00', 10),
      pair('pm', 'MON 13:00-18:00', 40),
    ],
  }, mondayMorning);
  expect(splitMonday.verdict).toBe("Can't tell.");
  expect(splitMonday.because[0].text).toBe(UNREAD_DAYS);
  expect(splitMonday.because[0].ids).toEqual(['am', 'pm']);
});

const UNREAD_SCHEDULE = "Day-specific hours were found, but I couldn't read them reliably. Check the sign before parking.";
const saturdayMorning = new Date(2026, 10, 14, 10, 0, 0);

function oneRow(string: string) {
  return { text: [{ id: 'row', string, bbox: [10, 20, 90, 40], score: 0.9 }] };
}

test('a partial day expression is not a complete schedule', () => {
  const cases: Array<[Date, string]> = [
    [saturdayMorning, 'MON-FRI, SAT-SUN 09:00-18:00'],
    [mondayMorning, 'SAT-SUN, MON-FRI 09:00-18:00'],
    [saturdayMorning, 'MON / ZA 09:00-18:00'],
    [mondayMorning, 'MON / ZA 09:00-18:00'],
    [saturdayMorning, 'MON–FRI, SAT–SUN 09:00-18:00'],
    [mondayMorning, 'SAT—SUN, MON—FRI 09:00-18:00'],
    [saturdayMorning, 'MON TO FRI, SAT TO SUN 09:00-18:00'],
    [mondayMorning, 'MON-FRI SAT 09:00-18:00'],
  ];
  for (const [when, string] of cases) {
    const decision = decide(oneRow(string), when);
    expect(decision.verdict).toBe("Can't tell.");
    expect(decision.because.map((line) => line.text)).toEqual([UNREAD_SCHEDULE]);
    expect(decision.because[0].ids).toEqual(['row']);
  }
  const applicable = decide(oneRow('MON-FRI 09:00-18:00'), mondayMorning);
  expect(applicable.verdict).toBe('Should I park here now? Not until 6pm.');
  const outside = decide(oneRow('MON-FRI 09:00-18:00'), saturdayMorning);
  expect(outside.verdict).toBe('Should I park here now? Yes. Today is outside Mon to Fri.');
  expect(decide(oneRow('MON–FRI 09:00-18:00'), saturdayMorning).verdict).toBe('Should I park here now? Yes. Today is outside Mon to Fri.');
  expect(decide(oneRow('MON—FRI 09:00-18:00'), saturdayMorning).verdict).toBe('Should I park here now? Yes. Today is outside Mon to Fri.');
  expect(decide(oneRow('MON TO FRI 09:00-18:00'), saturdayMorning).verdict).toBe('Should I park here now? Yes. Today is outside Mon to Fri.');
  const early = decide(oneRow('MON-FRI 09:00-18:00'), new Date(2026, 10, 16, 7, 0, 0));
  expect(early.verdict).toBe('Should I park here now? Yes, until 9am.');
  const late = decide(oneRow('MON-FRI 09:00-18:00'), new Date(2026, 10, 16, 19, 0, 0));
  expect(late.verdict).toBe('Should I park here now? Yes. The restriction ended at 6pm.');
  const disc = decide({
    text: [
      { id: 'disc', string: '2h', bbox: [10, 10, 40, 24], score: 0.9 },
      { id: 'row', string: 'MON-FRI, SAT 8 AM- 7 PM', bbox: [10, 40, 90, 56], score: 0.9 },
    ],
  }, mondayMorning);
  expect(disc.verdict).toBe("Can't tell.");
  expect(disc.because[0].text).toBe(UNREAD_SCHEDULE);
});

test('an invalid clock never becomes a parking permission', () => {
  const mondayEvening = new Date(2026, 10, 16, 20, 0, 0);
  for (const string of ['MON 09:00-18:99', 'MON 09:60-18:00', 'MON 24:01-18:00', 'MON 25:00-18:00', 'MON 9-18pm', 'MON 22:00-06:00']) {
    const decision = decide(oneRow(string), mondayEvening);
    expect(decision.verdict).toBe("Can't tell.");
    expect(decision.because[0].text).toBe(UNREAD_SCHEDULE);
    expect(decision.because[0].ids).toEqual(['row']);
  }
  expect(decide(oneRow('MON 09:00-18:00'), mondayEvening).verdict).toBe('Should I park here now? Yes. The restriction ended at 6pm.');
});

test('one day with one hour window is still decided', () => {
  const decision = decide({
    text: [pair('mon', 'MON 09:00-18:00', 10)],
  }, mondayMorning);
  expect(decision.verdict).toBe('Should I park here now? Not until 6pm.');
  expect(decision.because[0].id).toBe('mon');
});

test('a parking sign with no readable hours is not decided', () => {
  const decision = decide({
    text: [
      { id: 'days', string: 'MON - FRI', bbox: [10, 10, 80, 24], score: 0.8 },
      { id: 'word', string: 'parking', bbox: [10, 30, 80, 44], score: 0.8 },
    ],
  }, fridayAfternoon);
  expect(decision.verdict).toBe("Can't tell.");
  expect(decision.because[0].text).toBe('No hours found. The sign does not show a start and end time.');
});

test('parking hours are compared with the device clock', () => {
  expect(decide(parking, fridayAfternoon).verdict).toBe('Should I park here now? Not until 7pm.');
  expect(decide(parking, fridayMorning).verdict).toBe('Should I park here now? Yes, until 8am.');
  expect(decide(parking, fridayEvening).verdict).toBe('Should I park here now? Yes. The restriction ended at 7pm.');
  expect(decide(parking, saturday).verdict).toBe('Should I park here now? Yes. Today is outside Mon to Fri.');
  expect(decide(parking, fridayAfternoon).rule).toContain("this device's clock");
});

test('cups and notebooks inside the laptop frame are counted', () => {
  const decision = decide({
    objects: [
      { id: 'mug-a', name: 'coffee mug', bbox: [770, 256, 965, 418], score: 0.75 },
      { id: 'laptop', name: 'laptop', bbox: [257, 119, 753, 707], score: 0.47 },
      { id: 'mug-b', name: 'coffee mug', bbox: [78, 443, 242, 610], score: 0.76 },
      { id: 'note-a', name: 'notebook', bbox: [276, 400, 422, 668], score: 0.52 },
      { id: 'note-b', name: 'notebook', bbox: [371, 374, 704, 754], score: 0.59 },
      { id: 'cup', name: 'coffee cup', bbox: [754, 603, 942, 766], score: 0.71 },
      { id: 'mouse', name: 'mouse', bbox: [299, 433, 404, 543], score: 0.34 },
    ],
  }, fridayAfternoon);
  expect(decision.verdict).toBe('Tidy up before a video call? Yes: 3 cups and 2 notebooks are in shot.');
  expect(decision.rule).toBe('Page rule: cups and paper in the laptop frame decide this.');
});

test('a clear laptop frame is a no', () => {
  const decision = decide({
    objects: [{ id: 'laptop', name: 'laptop', bbox: [300, 200, 700, 700], score: 0.8 }],
  }, fridayAfternoon);
  expect(decision.verdict).toBe('Tidy up before a video call? No: the laptop frame is clear.');
});

test('non-latin text is left unread', () => {
  const menu = decide({
    objects: [{ id: 'paper', name: 'paper', bbox: [66, 33, 938, 970], score: 0.72 }],
    text: [
      { id: 'a', string: '+', bbox: [10, 10, 20, 20], score: 0.2 },
      { id: 'b', string: 'M', bbox: [10, 30, 20, 40], score: 0.5 },
      { id: 'c', string: 'KDEy', bbox: [10, 50, 40, 60], score: 0.7 },
      { id: 'd', string: '*tR', bbox: [10, 70, 40, 80], score: 0.5 },
      { id: 'e', string: 'E', bbox: [10, 90, 20, 100], score: 0.6 },
      { id: 'f', string: 'M', bbox: [10, 110, 20, 120], score: 0.4 },
    ],
  }, fridayAfternoon);
  expect(menu.verdict).toBe("Text found, but it isn't Latin script, so it couldn't be read.");
  expect(menu.because.map((line) => line.text)).toEqual(['6 text regions found; no readable Latin text identified.']);
  expect(menu.because[0].id).toBeNull();
  expect(menu.because[0].ids).toBeUndefined();
  const han = decide({
    text: [{ id: 'han', string: '宫保鸡丁', bbox: [10, 10, 80, 30], score: 0.4 }],
  }, fridayAfternoon);
  expect(han.verdict).toBe("Text found, but it isn't Latin script, so it couldn't be read.");
  expect(han.because.map((line) => line.text)).toEqual(['That line is not readable Latin.']);
  expect(han.because[0].id).toBeNull();
  expect(han.kind).toBe('script');
});

test('a cited low-confidence line is not decided', () => {
  const decision = decide({
    text: [
      { id: 'hours', string: '8 AM- 7 PM', bbox: [17, 33, 66, 40], score: 0.1 },
      { id: 'days', string: 'MON -FRI', bbox: [21, 48, 63, 56], score: 0.9 },
    ],
  }, fridayAfternoon);
  expect(decision.verdict).toBe("Can't tell.");
  expect(decision.because.map((line) => line.text)).toEqual(['"8 AM- 7 PM" is below the confidence threshold.']);
  expect(decision.because[0].id).toBe('hours');
});

test('uncited lines need a word or a price at 0.50', () => {
  const lines = [
    { id: 'low', string: '12.00', score: 0.4, bbox: [10, 10, 40, 20] },
    { id: 'price', string: '18.50', score: 0.6, bbox: [10, 16, 40, 26] },
    { id: 'han', string: '宫保鸡丁', score: 0.9, bbox: [10, 30, 80, 40] },
    { id: 'cited', string: '09. O0-18.OOh', score: 0.05, bbox: [10, 50, 80, 60] },
    { id: 'mark', string: 'M', score: 0.9, bbox: [10, 70, 20, 80] },
    { id: 'pair', string: 'Te', score: 0.8, bbox: [10, 90, 30, 100] },
    { id: 'word', string: 'Cafe', score: 0.5, bbox: [10, 110, 40, 120] },
  ];
  expect(shownText(lines, [{ id: 'cited', text: 'Hours on the sign.' }]).map((line: { id: string }) => line.id)).toEqual(['price', 'cited', 'word']);
});

test('a receipt without a total says what is missing', () => {
  const decision = decide({
    text: [
      { id: 'a', string: 'Coffee 48.00', bbox: [10, 10, 40, 20], score: 0.5 },
      { id: 'b', string: 'Tea 36.00', bbox: [10, 30, 40, 40], score: 0.5 },
    ],
  }, fridayAfternoon);
  expect(decision.verdict).toBe("Can't tell.");
  expect(decision.because[0].text).toContain('No total found');
});

test('nothing recognisable is its own result', () => {
  expect(decide({ objects: [], text: [] }, fridayAfternoon).verdict).toBe('Nothing recognisable found.');
  expect(decide({
    objects: [{ name: 'white object', bbox: [6, 7, 993, 990], score: 0.4 }],
    text: [],
  }, fridayAfternoon).verdict).toBe('Nothing recognisable found.');
  expect(decide({
    objects: [{ id: 'chair', name: 'chair', bbox: [10, 10, 80, 90], score: 0.8 }],
    text: [],
  }, fridayAfternoon).verdict).toBe("Can't tell.");
});

test('object rows sort by confidence and text stays in reading order', () => {
  const groups = groupObjects([
    { id: 'a', name: 'cup', score: 0.4 },
    { id: 'b', name: 'cup', score: 0.9 },
    { id: 'c', name: 'laptop', score: 0.5 },
  ]);
  expect(groups.map((group) => group.name)).toEqual(['cup', 'laptop']);
  expect(groups[0].count).toBe(2);
  expect(groups[0].bestId).toBe('b');
  expect(percent(0.876)).toBe(87.6);
  expect(percent(0.495)).toBe(49.5);
  expect(percentText(0.495)).toBe('49.5%');
  expect(percentText(0.4996)).toBe('50.0%');
  const edge = shownText([
    { id: 'edge', string: 'Cafe', score: 0.495, bbox: [10, 10, 40, 20] },
    { id: 'rounded', string: 'Cafe', score: 0.4996, bbox: [10, 24, 40, 34] },
    { id: 'kept', string: 'Cafe', score: 0.5, bbox: [10, 30, 40, 40] },
  ], []);
  expect(edge.map((line: { id: string }) => line.id)).toEqual(['kept']);
  const lines = readingOrder([
    { id: 'low', bbox: [50, 40, 80, 50] },
    { id: 'high', bbox: [10, 10, 40, 20] },
    { id: 'beside', bbox: [10, 42, 30, 50] },
  ]);
  expect(lines.map((line) => line.id)).toEqual(['high', 'beside', 'low']);
});

test('a long stage holds the scan at 90 percent and does not pass it', () => {
  const held = scanState({ elapsed: 5000, reduced: false, hasProgress: false, progress: 0 });
  expect(held?.y).toBeCloseTo(0.9, 5);
  const later = scanState({ elapsed: 8000, reduced: false, hasProgress: false, progress: 0 });
  expect(later?.y).toBeCloseTo(0.9, 5);
  expect(scanState({ elapsed: 100, reduced: false })).toBeNull();
  expect(scanState({ elapsed: 150, stageMs: 150, sinceEnd: 20, reduced: false })).toBeNull();
  expect(scanState({ elapsed: 400, reduced: true })).toBeNull();
  const followed = scanState({
    elapsed: 900,
    hasProgress: true,
    progress: 0.4,
    shown: 0.55,
    reduced: false,
  });
  expect(followed?.y).toBeCloseTo(0.4, 5);
  expect(linesDue(0, 40)).toBe(0);
  expect(linesDue(1, 40)).toBe(40);
  expect(boxStagger(1)).toBe(0);
  expect(boxStagger(25)).toBe(0);
  expect(boxStagger(9)).toBeCloseTo(30, 5);
});
