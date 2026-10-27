# Supabase reading sync

The `ielts-practice` project (`hgdnugbunlmhaaackqjc`) stores encrypted reading history behind the `reading-sync` Edge Function. The existing pairing code derives the space ID, authentication token and encryption keys in the browser; only ciphertext and a SHA-256 token hash reach the database.

`functions/reading-sync/handler.js` is an exact deployment copy of `sync-service/worker/index.js`. Update the worker source and copy it here before deploying. `postgres-store.js` uses the function's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; no server key belongs in browser code or source control. No external runtime packages are required.

The two `reading_sync_*` tables have RLS enabled and no public/client grants or policies. Only the Edge Function's service role can access them, after validating the space token. The batch RPC is `SECURITY INVOKER`, with execute permission restricted to `service_role`. Writes lock each space before allocating sequence IDs so concurrent uploads cannot overtake a reader's cursor.

Existing connections and old pairing links remain valid. On the first read of an unknown space, the function authenticates against the previous service, copies its encrypted history, and persists migration progress for safe retries. Once migration completes, that space no longer depends on the old service. Refresh all devices to switch to Supabase; older cached clients may still write to the previous service. Local sync cursors and acknowledgements are now scoped by backend URL, so each device pulls the imported history and backfills local records.

The frontend still syncs after submitted tests and saved settings, every 30 seconds while visible, on reconnect and on return to the page. Drafts stay on the device. First use: enable sync on one device, copy its pairing code/link, then join once on another device.

Deployment sources: `config.toml`, `functions/reading-sync/`, and the CLI-generated SQL under `migrations/`. `schema.sql` is a readable copy of the initial schema.
