import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { JwtPayload } from './types.js';

/**
 * 零依赖密码与令牌原语（node:crypto）：scrypt 口令散列 + HS256 JWT。
 * 生产可换更强 KDF / 成熟 JWT 库——此处求自包含、可测、无原生依赖。
 */

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): { hash: string; salt: string } {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const b64url = (s: string | Buffer): string => Buffer.from(s).toString('base64url');

export function signJwt(payload: JwtPayload, secret: string, ttlSeconds = 8 * 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const seg = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(body))}`;
  const sig = createHmac('sha256', secret).update(seg).digest('base64url');
  return `${seg}.${sig}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload;
    if (payload.exp !== undefined && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
