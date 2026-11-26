import type { Env } from '../env';
import { hmacHex } from './crypto';

export const mediaSignature = (env: Env, id: string, exp: number) => hmacHex(env.MEDIA_SIGNING_KEY, `media:${id}:${exp}`);

/**
 * Signed /media/:id/raw URL. The expiry is rounded up to a 5-minute step, so the
 * same picture keeps the same URL for a while and the browser can cache it
 * (a list of venue photos would otherwise re-download on every refresh).
 * Valid for 5–10 minutes.
 */
export async function signedMediaUrl(env: Env, id: string, base: string) {
  const step = 300;
  const exp = (Math.floor(Date.now() / 1000 / step) + 2) * step;
  const url = new URL(`/media/${id}/raw`, base);
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', await mediaSignature(env, id, exp));
  return { url: url.toString(), exp };
}
