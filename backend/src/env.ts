import type { ChannelHub } from './do/channel-hub';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  HUB: DurableObjectNamespace<ChannelHub>;
  ENVIRONMENT: string;
  /** Only honoured when ENVIRONMENT === 'development'. Never enable in production. */
  DEV_LOGIN_ENABLED?: string;
  /** Comma-separated list of allowed browser origins for CORS. */
  ALLOWED_ORIGINS?: string;
  /** HMAC key for signed media URLs (secret). */
  MEDIA_SIGNING_KEY: string;
  /** Firebase service-account JSON for push (secret, F05). Unset → pushes stay queued. */
  FCM_SERVICE_ACCOUNT?: string;
}

export type Role = 'member' | 'operator' | 'admin';

export interface AuthUser {
  id: string;
  nickname: string;
  role: Role;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AuthUser; sessionId: string };
};
