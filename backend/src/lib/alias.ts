import type { Env } from '../env';
import { hmacHex } from './crypto';

/**
 * 익명 오픈톡 automatic nicknames. Stable per (room, user) and unlinkable across rooms:
 * derived with an HMAC so nobody can recompute another user's alias from their id.
 */
const ADJ = ['졸린', '용감한', '수줍은', '반짝이는', '느긋한', '다정한', '씩씩한', '조용한', '명랑한', '엉뚱한', '포근한', '상냥한'];
const NOUN = ['달토끼', '고양이', '여우', '판다', '수달', '부엉이', '다람쥐', '펭귄', '알파카', '코알라', '해파리', '참새'];

export interface Alias {
  id: string;
  nickname: string;
}

export async function aliasFor(env: Env, roomId: string, userId: string): Promise<Alias> {
  const hex = await hmacHex(env.MEDIA_SIGNING_KEY, `alias:${roomId}:${userId}`);
  const n = parseInt(hex.slice(0, 8), 16);
  return {
    id: 'anon_' + hex.slice(8, 24),
    nickname: `${ADJ[n % ADJ.length]} ${NOUN[Math.floor(n / ADJ.length) % NOUN.length]} ${(n % 97) + 1}`,
  };
}
