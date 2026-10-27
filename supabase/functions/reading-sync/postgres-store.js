// Server only. No database credential is sent to the browser.
export function postgresStore(url, key, fetcher = globalThis.fetch) {
  if (!url || !key) throw new Error('missing-server-configuration');
  async function api(path, method = 'GET', body, prefer) {
    const headers = { apikey: key, Authorization: 'Bearer ' + key };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const response = await fetcher(url + '/rest/v1/' + path, {
      method, headers, signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error('database-request-failed');
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  return {
    createSpace: (id, hash, legacyComplete = true) => api('reading_sync_spaces?on_conflict=id', 'POST', { id, token_hash: hash, legacy_complete: legacyComplete }, 'resolution=ignore-duplicates,return=minimal'),
    getSpace: async id => (await api('reading_sync_spaces?id=eq.' + id + '&select=token_hash,legacy_cursor,legacy_complete'))[0] || null,
    appendRecords: (id, records, legacyCursor = null, legacyComplete = false) => api('rpc/reading_sync_append', 'POST', { p_space_id: id, p_records: records, p_legacy_cursor: legacyCursor, p_legacy_complete: legacyComplete }),
    listRecords: (id, after) => api('reading_sync_records?space_id=eq.' + id + '&seq=gt.' + after + '&select=seq,id,iv,ciphertext&order=seq.asc&limit=51'),
  };
}
