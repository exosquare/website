import { validateContestant } from '../validate.js';

export const authors = ['Grok', 'Astra', 'Fable', 'Gemini'];
export const versions = ['Original', 'Revised'];
export const slotId = (author, version) =>
  author.toLowerCase() + '-' + version.toLowerCase();
export const seeds = [
  'grok-original',
  'fable-revised',
  'astra-original',
  'gemini-revised',
  'fable-original',
  'grok-revised',
  'gemini-original',
  'astra-revised',
];
export const modelName = (player) => player.record?.model || player.name;
export const label = (player) =>
  [modelName(player), player.version].filter(Boolean).join(' ');

export async function readRoster(base) {
  const response = await fetch(new URL('roster.json', base));
  if (!response.ok) throw Error('Unable to load the player roster.');
  const records = await response.json();
  const players = [];
  for (const name of authors) {
    for (const version of versions) {
      const id = slotId(name, version),
        record = records[id];
      let weights = null;
      if (record) {
        const file = await fetch(new URL(record.file, base));
        if (!file.ok)
          throw Error('Unable to load ' + name + ' ' + version + '.');
        const result = validateContestant(
          new Uint8Array(await file.arrayBuffer()),
        );
        if (!result.ok)
          throw Error(
            'Invalid authored network for ' + name + ' ' + version + '.',
          );
        weights = result.weights;
      }
      players.push({
        id,
        name,
        version,
        weights,
        record,
        kind: record ? 'authored' : 'missing',
      });
    }
  }
  return players;
}

export function fromUpload(name, bytes) {
  const result = validateContestant(bytes);
  if (!result.ok)
    throw Error(
      'Invalid network (' +
        result.report.errors[0].code +
        '). Check the JSON against the authoring skill.',
    );
  return {
    id: 'upload-' + result.fingerprint,
    name: name.replace(/\.json$/i, '').slice(0, 60) || 'Uploaded player',
    version: '',
    kind: 'upload',
    weights: result.weights,
  };
}
