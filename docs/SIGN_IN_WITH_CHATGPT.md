# Sign in with ChatGPT

Status: local signed-fixture website workflow verified (2026-10-23), T24/W08. No registered OpenAI client ID/callback is available here. Signed provider fixtures are not live OpenAI sign-in acceptance. T23 actual ChatGPT installation, T24 live-provider acceptance and the entire remaining implementation roadmap stay open.

## Account and local artwork

Open **Account** in the editor header or command search. When the site is configured, **Continue with ChatGPT** opens a separate sign-in window, preserving the current editor and unsaved local artwork. After OpenAI verifies a new identity, return to Canoli and explicitly choose **Create Canoli account**. An existing linked identity signs into its existing account. A matching email address never merges accounts.

To add another sign-in method, first sign into the intended Canoli account. If its last verification is older than five minutes, verify an existing linked identity with **Continue with ChatGPT** first. Then continue with the other ChatGPT identity and explicitly confirm **Link this ChatGPT sign-in**. An identity already attached to a different account cannot be reassigned. New verified identities create separate accounts unless deliberately linked while authenticated. Enterprise identity/SSO and administrative account recovery are separate unfinished scope.

**Cancel sign-in** invalidates the pending attempt and prevents a late verified response from publishing it. Cancel account confirmation discards the verified proposal. Closing the Account dialog leaves a separately opened sign-in window active; use Cancel to end the attempt. Expired/cancelled attempts require a new sign-in. If a callback already finished, inspect the current account and use **Sign out of Canoli** to end the resulting session. Signing out affects Canoli in this browser, preserving local documents and independently granted plugin connections; it does not sign out of the ChatGPT website.

Identity sign-in requests only `openid profile email`. It does not authorize inference, use ChatGPT plan credits, read conversations, upload source files, connect documents, or grant internal plugin/scripting/REST permissions. The account service is outside the public document DOM and project/history serialization. Unconfigured installations keep the local editor available and show that sign-in is unavailable.

## Account data export and deletion

The metadata lifecycle is locally verified with signed fixtures, concurrent real processes, the production editor and a clean compiled host. Live OpenAI acceptance and broader W08 operations remain open. See the dated roadmap for exact gates and evidence.

**Download account data** downloads `canoli-account.json`: the version-1 `canoli-account` format contains `exportedAt`, the current account's `id/name/email/createdAt`, its OpenAI identity mappings (`provider/issuer/clientId/subject/name/email/emailVerified`) and `activeSessionCount`. Nullable profile claims remain null. Dates are ISO timestamps. This is account metadata, not an artwork backup or reusable login credential. No cookies, session hashes, CSRF values, transaction state, PKCE verifiers, provider tokens, other accounts, documents or source files are exported. The browser validates the strict portable format and refreshes the current account before downloading; malformed or changed-account results are discarded.

**Delete Canoli account…** opens an explicit confirmation. Verify an already linked identity of the current account if verification is over five minutes old, type the exact text **DELETE**, then choose **Permanently delete Canoli account**. Cancel leaves the account intact. A different identity, including one with the same email, cannot verify this account. Verification uses a new OIDC code/nonce exchange; it does not promise that OpenAI asks for a password or MFA again. Linking a new identity does not extend the original verification window.

Deletion atomically removes this service's profile, all sign-in mappings and matching pending proposals, and revokes every session for that account. Other accounts remain. Authenticated callbacks lose their browser authority; transient hashed identity markers and a database-ordered transaction sequence also reject anonymous callbacks begun before deletion, across processes and restarts. A fresh sign-in can explicitly create a new account with a new ID. Markers expire after ten minutes, when all older attempts have expired, and are physically removed by the next request's pruning pass. SQLite pages, WAL files and backups are not forensically erased; this is logical account deletion, not a legal-compliance or secure-erasure guarantee.

Local artwork, undo/redo, recovery, downloaded projects and independently granted document/plugin connections remain under their existing local controls. Account deletion does not delete an OpenAI account or sign out the ChatGPT website. Use Save project to back up artwork separately. Broader hosted-asset deletion, enterprise recovery, billing and operational policies remain unfinished W08 scope.

## Optional same-origin site host

Build with `npm run build`, then run `npm run start:site` on Node.js 24 or later (verified runtime 24.0.1; its built-in SQLite currently emits an experimental-feature warning). The site host binds `127.0.0.1:8788` by default and serves only the built `dist` directory plus account routes. Existing `start:api` remains the independent loopback, in-memory REST service. The site host does not proxy, expose or authenticate that service.

`npm run build:site` produces the self-contained `dist-site/index.mjs`, dependency notices and source/runtime manifest; the normal build includes it. Deploy `dist` and `dist-site` together, with the process working directory containing both. The compiled host needs no TypeScript runner or runtime node_modules. `npm run dev:site` runs the source host during development. The clean compiled-host check verifies every public built file, signed-fixture account creation/sign-out, and session/identity reuse across actual process restarts. This proves local runtime behavior, not OpenAI registration or hosted acceptance.

Set server-side configuration through the process environment. Node's `--env-file` option can load an ignored local file, for example `node --env-file=.env.local dist-site/index.mjs`. Never put a client secret in Vite variables or the browser bundle.

| Setting | Contract |
| --- | --- |
| `CANOLI_SITE_PORT` | Loopback listening port; default 8788. |
| `CANOLI_AUTH_ORIGIN` | Exact public HTTPS origin; no path/query. Required when configuring sign-in. Forward the matching Host through your TLS proxy. Forwarded-host headers never override it. |
| `CANOLI_AUTH_CLIENT_ID` | Actual registered OpenAI OAuth client ID, not an illustrative ID. Its absence leaves sign-in unconfigured. |
| `CANOLI_AUTH_REDIRECT_URI` | Exact registered `https://your-origin/auth/openai/callback`, matching the configured origin. |
| `CANOLI_AUTH_TOKEN_AUTH_METHOD` | Registered `none` (default) for public identity clients, or `client_secret_basic` for confidential clients. No automatic downgrade. |
| `CANOLI_AUTH_CLIENT_SECRET` | Required only for the confidential method; keep in server-side secret storage. Never requested by the browser or sent in the form body. |
| `CANOLI_AUTH_DATABASE` | Private SQLite path, outside the served directory; default `.canoli/accounts.sqlite`, ignored by Git. Restrict access/backups as account data. |
| `CANOLI_AUTH_ALLOW_INSECURE_LOOPBACK` | Explicit `1` permits HTTP loopback for development only. Rejected for public HTTP origins and disabled when `NODE_ENV=production`. |

Production sessions require HTTPS. The optional site server supplies the application boundary, not TLS certificates, a public deployment, partner registration, enterprise policy, operational abuse controls, backups or a complete hosted-security review. Local loopback development uses a separately named cookie. Do not deploy the independent REST prototype as an account backend.

## Verification and durable authority

The identity client loads OpenAI's public discovery document at `https://auth.openai.com/.well-known/openid-configuration`. Issuer and authorization/token/JWKS endpoints must remain on the exact official HTTPS origin. Redirects, malformed/oversized JSON and unsupported signing/token-authentication methods reject. Cached JWKS use maintained `jose` verification; an unfamiliar signing key triggers a bounded refresh. The actual production discovery was fetched read-only during implementation and advertises RS256 and both supported registered token methods.

Each attempt has fresh server-generated state, S256 PKCE verifier/challenge and nonce. A private browser cookie and durable generation bind the one-time transaction. Callbacks atomically consume matching state before code exchange. Verify signature, issuer, client audience, nonce, expiration, issue time and authorized party where applicable. Only the verified issuer/client/subject tuple resolves an external identity. Names/email are display claims; email equality never proves local account ownership. Identity-only responses need an ID token and do not require access/refresh tokens.

Private SQLite schema 2 stores account/profile/link records, hashed opaque browser sessions, CSRF values and short-lived transaction/confirmation data. It never stores the OpenAI ID/access/refresh tokens. WAL transactions and foreign keys support atomic one-time consumption, rollback and separate connections to the same private database. Sessions rotate after authentication/confirmation; old cookies lose authority. Cancellation/new attempts advance a generation, and sign-out deletes the browser authority, so held token exchanges cannot resurrect it. SQLite files are owner-only; transaction expiration is logical deletion, not a secure-erasure or encrypted-backup promise. Schema-1 migration is atomic and preserves profiles, cookies and CSRF bindings; migrated sessions have no recent-verification lease and must verify an existing identity before linking or deletion. Failed migration rolls back and leaves the legacy database retryable. Distributed deployment across unrelated databases is not supported.

Transactions expire after ten minutes, verified confirmations after five, anonymous browser authority after fifteen, authenticated sessions after eight hours. Origin/Host and per-browser CSRF checks protect state-changing routes. HTTP-only host-only production cookies use `Secure`, `SameSite=Lax` and `Path=/`. Account responses use `no-store`; callback pages use a nonce CSP, remove authorization parameters from history and send only a same-origin account-changed notification. No token appears in that message. The editor refreshes account status instead of trusting message claims.

## HTTP surface

All paths below belong to the same-origin site host, separate from `/api/v1`.

| Method/path | Behavior |
| --- | --- |
| `GET /auth/session` | Lazily obtains current identity status, browser-bound CSRF value and `verificationExpiresIn` (0–300000 milliseconds remaining, relative to the response); configured false when unavailable. A stale cookie returns 401 without overwriting a newer rotated cookie. |
| `POST /auth/openai` | URL-encoded form or JSON `{csrf,intent:"signin"}`; `intent` may be `signin`, `link` or `reauthenticate`. Link requires recent current-account verification; reauthenticate accepts only an already linked identity of the current account and rotates its cookie. Starts the matching anonymous/signed-in flow and redirects to the official authorization endpoint in the new window. |
| `GET /auth/openai/callback` | Validates one-use browser-bound state and exchanges/verifies the code. Produces a private completion/error page; new identity publication still needs confirmation. |
| `POST /auth/confirm` | `{csrf,pendingId}` explicitly creates/links the verified proposal and rotates the application session. |
| `POST /auth/cancel` | `{csrf}` invalidates pending attempts/confirmations while retaining existing local account authority. |
| `POST /auth/signout` | `{csrf}` revokes this browser's session and expires its cookie. |
| `POST /auth/export` | `{csrf}` returns the current account's strict metadata JSON with a fixed attachment filename; requires an authenticated session. |
| `POST /auth/delete` | `{csrf,confirmation:"DELETE"}` requires verification within five minutes; atomically deletes the account and revokes all its sessions, then expires this cookie. |
| `POST /auth/reset` | Same-origin recovery for missing/stale browser authority; retains any currently valid session. |
| `GET /auth/complete` | Credential-free sign-in-window completion view. |

Only the bounded account metadata/form surface accepts writes; it is not an image-upload route. Missing/stale authenticated authority returns 401; an invalid origin returns 403; sensitive operations without recent verification return 409 with `code:"VERIFICATION_REQUIRED"`. Invalid CSRF, confirmation or action bodies reject with 400. Errors are generic and exclude provider tokens, secrets, raw token responses and account-existence probes. Setup, persistence, signed fixture, real-browser and real-provider acceptance evidence belongs in the dated implementation roadmap.

Official references: [website sign-in](https://developers.openai.com/siwc/website), [registration](https://developers.openai.com/siwc/request-client-id), [identity and plan scope distinction](https://developers.openai.com/siwc/quickstart).
