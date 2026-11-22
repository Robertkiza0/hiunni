import type { Env } from '../env';
import { newId } from './http';
import { kstParts } from './time';

export type NotificationType = 'comment' | 'dm' | 'saved';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  /** Preview text. Ignored when `sensitive` (e.g. secret comments, DM bodies). */
  body?: string | null;
  link?: string | null;
  /** Never put the body in the inbox or the push payload. */
  sensitive?: boolean;
}

export interface Prefs {
  comment: boolean;
  dm: boolean;
  saved: boolean;
  dndStart: number | null;
  dndEnd: number | null;
  hideContent: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  comment: true,
  dm: true,
  saved: true,
  dndStart: null,
  dndEnd: null,
  hideContent: false,
};

export async function loadPrefs(env: Env, userId: string): Promise<Prefs> {
  const r = await env.DB.prepare('SELECT * FROM notification_prefs WHERE user_id = ?')
    .bind(userId)
    .first<{
      comment: number;
      dm: number;
      saved: number;
      dnd_start: number | null;
      dnd_end: number | null;
      hide_content: number;
    }>();
  if (!r) return { ...DEFAULT_PREFS };
  return {
    comment: !!r.comment,
    dm: !!r.dm,
    saved: !!r.saved,
    dndStart: r.dnd_start,
    dndEnd: r.dnd_end,
    hideContent: !!r.hide_content,
  };
}

/** DND window in KST minutes; may wrap midnight (23:00–07:00). start === end means off. */
export function inDnd(p: Pick<Prefs, 'dndStart' | 'dndEnd'>, ms: number): boolean {
  if (p.dndStart == null || p.dndEnd == null || p.dndStart === p.dndEnd) return false;
  const m = kstParts(ms).minute;
  return p.dndStart < p.dndEnd ? m >= p.dndStart && m < p.dndEnd : m >= p.dndStart || m < p.dndEnd;
}

export type PushDecision = 'queued' | 'disabled' | 'dnd' | 'no_devices';

/**
 * Always writes the in-app inbox row; queues an OS push only if the user's
 * preferences allow it. Delivery from push_outbox to FCM/APNs is not implemented
 * (credentials not provided) — see README "F05".
 */
export async function notify(
  env: Env,
  input: NotifyInput,
  now = Date.now()
): Promise<{ notificationId: string; push: PushDecision }> {
  const id = newId();
  const inboxBody = input.sensitive ? null : (input.body ?? null);
  await env.DB.prepare(
    'INSERT INTO notifications (id, user_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, input.userId, input.type, input.title, inboxBody, input.link ?? null, now)
    .run();

  const prefs = await loadPrefs(env, input.userId);
  if (!prefs[input.type]) return { notificationId: id, push: 'disabled' };
  if (inDnd(prefs, now)) return { notificationId: id, push: 'dnd' };

  const { results: devices } = await env.DB.prepare(
    'SELECT id, platform FROM device_tokens WHERE user_id = ?'
  )
    .bind(input.userId)
    .all<{ id: string; platform: string }>();
  if (devices.length === 0) return { notificationId: id, push: 'no_devices' };

  const hide = prefs.hideContent || input.sensitive;
  const payload = JSON.stringify({
    title: hide ? '하이언니' : input.title,
    body: hide ? '새 알림이 있습니다' : (input.body ?? ''),
    link: input.link ?? null,
    notificationId: id,
  });
  await env.DB.batch(
    devices.map(d =>
      env.DB.prepare(
        'INSERT INTO push_outbox (id, notification_id, device_token_id, platform, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(newId(), id, d.id, d.platform, payload, now)
    )
  );
  return { notificationId: id, push: 'queued' };
}
