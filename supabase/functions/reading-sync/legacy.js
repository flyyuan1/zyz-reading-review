import { validateRecords } from './handler.js';

// Old pairing codes remain valid. Import ciphertext only, with a durable cursor
// so a timeout or redeployment resumes safely without exposing study contents.
export function legacyRestorer(db, fetcher = globalThis.fetch) {
  return async function restore(id, token, hash, existing) {
    let space = existing;
    let cursor = space?.legacy_cursor || 0;
    while (true) {
      const response = await fetcher('https://zyz-reading-sync.chalky-grass-0591.chatgpt.site/v1/spaces/' + id + '/records?after=' + cursor, {
        headers: { 'X-Sync-Token': token }, signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401 || response.status === 404) {
        if (!space) return null;
        throw new Error('legacy-access-denied');
      }
      if (!response.ok) throw new Error('legacy-unavailable');
      const text = await response.text();
      if (text.length > 512 * 1024) throw new Error('invalid-legacy-page');
      const page = JSON.parse(text);
      if (!Array.isArray(page.records) || page.records.length > 50 || !Number.isSafeInteger(page.cursor) || page.cursor < cursor || typeof page.hasMore !== 'boolean') throw new Error('invalid-legacy-page');
      let seq = cursor;
      for (const row of page.records) {
        if (!Number.isSafeInteger(row.seq) || row.seq <= seq || row.seq > page.cursor) throw new Error('invalid-legacy-page');
        seq = row.seq;
      }
      if (page.hasMore && (!page.records.length || page.cursor <= cursor)) throw new Error('invalid-legacy-page');
      for (let i = 0; i < page.records.length; i += 20) validateRecords({ records: page.records.slice(i, i + 20) });
      if (!space) {
        // Only an authenticated response from the old service permits restoring
        // an unknown space. Arbitrary/wrong codes never create a new connection.
        await db.createSpace(id, hash, false);
        space = await db.getSpace(id);
        if (!space || space.token_hash !== hash) return null;
      }
      for (let i = 0; i < page.records.length; i += 20) await db.appendRecords(id, page.records.slice(i, i + 20));
      await db.appendRecords(id, [], page.cursor, !page.hasMore);
      cursor = page.cursor;
      if (!page.hasMore) return { ...space, legacy_complete: true, legacy_cursor: cursor };
    }
  };
}
