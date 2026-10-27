# Cross-device study sync implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated components, followed by spec and quality review. The user has explicitly authorized direct execution, autonomous decisions and deployment without further approval prompts.

**Goal:** Preserve the existing reading website while automatically sharing encrypted submitted study history between paired phone and computer browsers.

**Architecture:** GitHub Pages serves the existing app and independent browser crypto, sync and UI modules. A small Sites Worker stores immutable encrypted envelopes in D1 and exposes authenticated, paginated APIs; all scoring and source-history merging remain in the existing browser Store.

**Tech Stack:** Browser Web Crypto, plain JavaScript/CSS, Cloudflare Worker ESM, D1 SQLite migrations, Node test runner, browser end-to-end tests.

## Shared contract

`ReadingSyncProtocol.createCode()` produces `ZYZ1-` plus 32 random bytes encoded base64url. `derive(code)` returns `{spaceId, token, key, recordKey}` using domain-separated HKDF; spaceId is SHA-256-derived and 64 lowercase hex characters. `seal(keys, payload)` returns `{id, iv, ciphertext}` using keyed content identification and AES-GCM; `open(keys, envelope)` verifies identity and decrypts it. Expose CommonJS exports for Node tests and `window.ReadingSyncProtocol` in browsers. Canonical JSON must sort object keys.

Payloads are `{kind:'attempt'|'source'|'settings',value:...}`. A settings value is `{fields:{[setting]:{value,modifiedAt,deviceId}}}`. A normal attempt value is the existing `ReadingStudyCore.validAttempt` result. A source value is the existing validated source attempt.

API is `PUT /v1/spaces/{spaceId}` (idempotently create), `GET /v1/spaces/{spaceId}/records?after={cursor}` and `POST /v1/spaces/{spaceId}/records` with `{records:[envelopes]}`. Every call supplies `X-Sync-Token`; the server persists only its SHA-256 hash. GET returns `{records:[{seq,id,iv,ciphertext}],cursor,hasMore}`. POST returns `{accepted:[ids]}`. Record IDs are 64 lowercase hex, IVs are 12 bytes base64url, ciphertext is at most 96 KiB base64url. Requests are at most 512 KiB and batches at most 20. Pagination is ordered by monotonic sequence, at most 50 records and at most 512 KiB total serialized response. Only ciphertext is stored. Errors use `{error:'safe code'}` and correct HTTP status.

## Task 1: Cloud service

Files: `../sync-service/worker/index.js`, `../sync-service/drizzle/0000_sync.sql`, `../sync-service/drizzle/meta/_journal.json`, `../sync-service/tests/worker.test.mjs`.

- [ ] Add failing Node tests for unauthorized access, two isolated spaces, replay-idempotent writes, pagination, malformed envelopes, forbidden origin and oversized requests.
- [ ] Implement exported `fetch(request,env)` using `env.DB`, parameterized SQL, transactional batch writes, hashed credentials and no-store responses. Do not log secrets. Use the bound migration tables, never runtime CREATE TABLE.
- [ ] Run `node --test tests/worker.test.mjs`, expecting every behavioral test to pass.
- [ ] Review against the API contract, then inspect query authorization and limit enforcement.

## Task 2: Browser protocol and synchronization engine

Files: root `review-sync-protocol.js`, `review-sync-client.js`, `review-sync.test.cjs`.

- [ ] Test crypto round trips, domain separation, tamper rejection and deterministic content IDs.
- [ ] Implement the shared protocol and a client factory `ReadingSyncClient.create({storage,store,core,sourceBackup,sourceIndex,endpoint,fetch,crypto,onState})`; return `createSpace()`, `join(code)`, `sync()`, `disconnect()`, `getCode()` and `getState()`. Allow browser defaults and test injection.
- [ ] Persist connection, per-space cursor and acknowledgements; serialize runs, use limited encrypted batches, pull and merge remote data before advancing cursors, and upload local additions. Retain conflicts in cloud and expose their count without overwriting reliable local records. Never touch test draft keys.
- [ ] Test two isolated stores merging their prior histories, new records, retries, quota failure before cursor updates, source enrichment/conflict, settings field merge and disconnect preservation.
- [ ] Run `node --test review-sync.test.cjs` and existing Store/source tests. Review spec compliance, then review failure recovery and crypto boundary.

## Task 3: UI and lifecycle

Files: root `review-sync-ui.js`, `review-sync.css`; Store change only if required to emit settings-update metadata.

- [ ] Add a responsive panel to the plan page, and compact status/link on other pages. Use buttons for create, pair, copy code/link, sync now and disconnect. Display errors with retry and distinguish pending/offline from success.
- [ ] Strip pairing fragments immediately, never auto-replace an existing different connection, and do not expose a secret until the user requests copy/display. Clipboard failure must provide selectable text.
- [ ] Trigger sync on submitted/imported records, visibility, online and timed visible checks; disconnect cancels timers and stale work. Never clear records or interfere with a live test draft.
- [ ] Verify keyboard interactions, phone width and desktop width with two independent browser contexts.

## Task 4: Integrate, publish and audit

Files: root generation scripts and all published HTML cache references; corresponding `github-pages-site` and `github-upload-checkout` assets; README and use guide; sync-service hosting manifest and release evidence.

- [ ] Register one new Sites service, persist its exact identity, configure D1 and schema-only migrations, and package the Worker with supported helpers. Use native Sites tools for source credentials, publication and the approved publicly reachable API audience.
- [ ] Deploy and test API with synthetic records and the actual GitHub origin. Only after readiness configure the client endpoint.
- [ ] Add script/style references to the generators and all applicable pages. Run existing Node regression suites and browser checks against plan, catalog, review and test pages.
- [ ] Commit/push only intended website assets to the existing GitHub repository. Verify production Pages serves new scripts and an API CORS request succeeds.
- [ ] Run production two-browser tests proving initial merge, new submission propagation, offline retry, export/import compatibility and untouched drafts; record exact results without private study data.
- [ ] Verify all design requirements against current files and runtime evidence. Mark steps complete only with evidence; return the live plan-page link and one-time pairing instructions.

## Review and execution authorization

The user explicitly said “直接执行，后面的都不需要问我了，你自己决定”. This supersedes further interactive design/plan/branch execution gates. The confirmed design is implemented with autonomous technical choices, preserving the stated scope and data protection. A feature branch in the existing clean checkout isolates product changes; no additional worktree is required.
