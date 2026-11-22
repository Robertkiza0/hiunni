import type { Env } from '../env';

export type Channel = `room:${string}` | `dm:${string}` | 'status';

export const hubFor = (env: Env, channel: Channel) => env.HUB.get(env.HUB.idFromName(channel));

export async function broadcast(env: Env, channel: Channel, event: Record<string, unknown>) {
  await hubFor(env, channel).broadcast({ channel, sentAt: Date.now(), ...event });
}

export async function revoke(env: Env, channel: Channel, userId: string, reason: string) {
  await hubFor(env, channel).revoke(userId, reason);
}

/** Who may subscribe to a channel. Re-checked when a ticket is redeemed. */
export async function canSubscribe(env: Env, channel: string, userId: string): Promise<boolean> {
  if (channel === 'status') return true;
  const [kind, id] = splitChannel(channel);
  if (kind === 'room') {
    const r = await env.DB.prepare(
      `SELECT 1 FROM rooms r JOIN room_members m ON m.room_id = r.id
        WHERE r.id = ? AND r.status = 'open' AND m.user_id = ? AND m.state = 'active'`
    )
      .bind(id, userId)
      .first();
    return r !== null;
  }
  if (kind === 'dm') {
    const r = await env.DB.prepare(
      'SELECT 1 FROM dm_conversations WHERE id = ? AND (user_a = ? OR user_b = ?)'
    )
      .bind(id, userId, userId)
      .first();
    return r !== null;
  }
  return false;
}

export function splitChannel(channel: string): [string, string] {
  const i = channel.indexOf(':');
  return i < 0 ? [channel, ''] : [channel.slice(0, i), channel.slice(i + 1)];
}

export function isChannel(s: string): s is Channel {
  return s === 'status' || /^(room|dm):[0-9a-z]{1,64}$/.test(s);
}
