import { fetch as handle } from './handler.js';
import { postgresStore } from './postgres-store.js';
import { legacyRestorer } from './legacy.js';

const db = postgresStore(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const env = { SYNC_STORE: db, restoreSpace: legacyRestorer(db) };
Deno.serve(request => {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/reading-sync(?=\/|$)/, '') || '/';
  return handle(new Request(url, request), env);
});
