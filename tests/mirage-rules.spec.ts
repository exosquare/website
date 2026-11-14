import { test, expect } from '@playwright/test';
import { decide, groupObjects, percent, readingOrder } from '../public/experiments/mirage/rules.js';
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

test('a receipt without a date says date not found', () => {
  const decision = decide({
    text: [
      { id: 'tea', string: 'Tea', bbox: [10, 10, 30, 20], score: 0.7 },
      { id: 'total', string: 'TOTAL $12.00', bbox: [10, 30, 40, 40], score: 0.8 },
    ],
  }, fridayAfternoon);
  expect(decision.verdict).toBe('Log $12.00 as food and drink, date not found.');
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
  expect(menu.verdict).toBe("Can't tell.");
  expect(menu.because[0].text).toBe("Text found, but it isn't Latin script, so it wasn't read.");
  const han = decide({
    text: [{ id: 'han', string: '宫保鸡丁', bbox: [10, 10, 80, 30], score: 0.4 }],
  }, fridayAfternoon);
  expect(han.because[0].text).toBe("Text found, but it isn't Latin script, so it wasn't read.");
  expect(han.kind).toBe('script');
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
  expect(percent(0.876)).toBe(88);
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
