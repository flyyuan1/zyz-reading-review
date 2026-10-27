const ORIGINS = new Set(['https://flyyuan1.github.io', 'http://localhost:8788', 'http://127.0.0.1:8788']);
const MAX_BODY = 512 * 1024;
const MAX_CIPHERTEXT = 96 * 1024;
const HEX_ID = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}
function base64urlBytes(value, expectedBytes) {
  if (typeof value !== 'string' || !BASE64URL.test(value)) return false;
  try {
    const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const canonical = btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return canonical === value && (expectedBytes === undefined || decoded.length === expectedBytes);
  } catch { return false; }
}
async function tokenHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function equalHash(left, right) {
  if (typeof left !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
async function readBody(request) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY)) throw new HttpError(413, 'request_too_large');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new HttpError(413, 'request_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function readJson(request) {
  const bytes = await readBody(request);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new HttpError(415, 'json_required');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, 'invalid_json'); }
}
export function validateRecords(body) {
  if (!body || !Array.isArray(body.records) || body.records.length > 20 || body.records.length < 1) throw new HttpError(400, 'invalid_batch');
  for (const record of body.records) {
    if (!record || typeof record.id !== 'string' || !HEX_ID.test(record.id) ||
        !base64urlBytes(record.iv, 12) || typeof record.ciphertext !== 'string' ||
        record.ciphertext.length < 22 || record.ciphertext.length > MAX_CIPHERTEXT || !base64urlBytes(record.ciphertext)) throw new HttpError(400, 'invalid_record');
  }
  return body.records;
}
function d1Store(DB) {
  return {
    createSpace: (id, hash) => DB.prepare('INSERT OR IGNORE INTO sync_spaces (id, token_hash) VALUES (?, ?)').bind(id, hash).run(),
    getSpace: id => DB.prepare('SELECT token_hash FROM sync_spaces WHERE id = ?').bind(id).first(),
    appendRecords: (id, records) => DB.batch(records.map(record => DB.prepare('INSERT OR IGNORE INTO sync_records (space_id, id, iv, ciphertext, protocol_version) VALUES (?, ?, ?, ?, 1)').bind(id, record.id, record.iv, record.ciphertext))),
    listRecords: async (id, after) => (await DB.prepare('SELECT seq, id, iv, ciphertext FROM sync_records WHERE space_id = ? AND seq > ? ORDER BY seq ASC LIMIT 51').bind(id, after).all()).results,
  };
}
export async function fetch(request, env) {
  const origin = request.headers.get('origin');
  const headers = new Headers({ 'cache-control': 'no-store', 'vary': 'Origin' });
  if (origin && ORIGINS.has(origin)) headers.set('access-control-allow-origin', origin);
  const respond = (value, status = 200) => {
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(value), { status, headers });
  };
  try {
    if (origin !== null && !ORIGINS.has(origin)) throw new HttpError(403, 'origin_forbidden');
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') return respond({ service: 'reading-sync', version: 1 });
    const route = /^\/v1\/spaces\/([a-f0-9]{64})(\/records)?$/.exec(url.pathname);
    if (!route) throw new HttpError(404, 'not_found');
    const methods = route[2] ? ['GET', 'POST'] : ['PUT'];
    if (request.method === 'OPTIONS') {
      const method = request.headers.get('access-control-request-method');
      const requestedHeaders = (request.headers.get('access-control-request-headers') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if (!origin || !methods.includes(method) || requestedHeaders.some(value => !['content-type', 'x-sync-token'].includes(value))) throw new HttpError(403, 'preflight_forbidden');
      headers.set('access-control-allow-methods', methods.join(', '));
      headers.set('access-control-allow-headers', 'Content-Type, X-Sync-Token');
      headers.set('vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
      return new Response(null, { status: 204, headers });
    }
    if (!methods.includes(request.method)) { headers.set('allow', [...methods, 'OPTIONS'].join(', ')); throw new HttpError(405, 'method_not_allowed'); }
    const token = request.headers.get('x-sync-token');
    if (!token || token.length !== 43 || !base64urlBytes(token, 32)) throw new HttpError(401, 'unauthorized');
    const hash = await tokenHash(token);
    const spaceId = route[1];
    const db = env.SYNC_STORE || d1Store(env.DB);
    if (!route[2]) {
      await readBody(request);
      // Creation is race safe and never replaces an existing credential.
      await db.createSpace(spaceId, hash);
    }
    let space = await db.getSpace(spaceId);
    if (!space && env.restoreSpace) space = await env.restoreSpace(spaceId, token, hash);
    if (!space || !equalHash(space.token_hash, hash)) throw new HttpError(401, 'unauthorized');
    if (space.legacy_complete === false && env.restoreSpace) await env.restoreSpace(spaceId, token, hash, space);
    if (!route[2]) return respond({ ok: true });
    if (request.method === 'POST') {
      const records = validateRecords(await readJson(request));
      // Each storage adapter commits a batch atomically; immutable IDs make retries safe.
      await db.appendRecords(spaceId, records);
      return respond({ accepted: [...new Set(records.map(record => record.id))] });
    }
    const afterValue = url.searchParams.get('after') ?? '0';
    if (!/^(0|[1-9]\d*)$/.test(afterValue) || !Number.isSafeInteger(Number(afterValue))) throw new HttpError(400, 'invalid_cursor');
    const after = Number(afterValue);
    const result = await db.listRecords(spaceId, after);
    const records = [];
    let cursor = after;
    for (const record of result) {
      if (records.length === 50) break;
      // All envelope fields are ASCII. Reserve the longer boolean spelling too.
      if (JSON.stringify({ records: [...records, record], cursor: record.seq, hasMore: false }).length > MAX_BODY) break;
      records.push(record);
      cursor = record.seq;
    }
    return respond({ records, cursor, hasMore: result.length > records.length });
  } catch (error) {
    return respond({ error: error instanceof HttpError ? error.message : 'internal_error' }, error instanceof HttpError ? error.status : 500);
  }
}
export default { fetch };
