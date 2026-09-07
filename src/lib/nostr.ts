import { decode, npubEncode } from 'nostr-tools/nip19';
import site from '../data/site.json';

function profile() {
  if (!site.links.npub) return null;
  const key = decode(site.links.npub);
  if (key.type !== 'npub' || key.data.length !== 64) {
    throw new Error(
      'The configured Nostr identity must be a 32-byte public npub.',
    );
  }
  const npub = npubEncode(key.data);
  return {
    npub,
    hex: key.data,
    url: new URL(`/${npub}`, site.nostrIdentity.profileGateway).href,
    appUrl: `nostr:${npub}`,
    label: site.nostrIdentity.label,
  };
}
export const nostrProfile = profile();
