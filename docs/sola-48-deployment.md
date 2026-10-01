# SOLA-48 — Production deployment prerequisites (SOLA-34 entitlements)

Status: **code merged and pushed; live happy path still gated by secrets.**
Owner: Akira (engineer). Reviewer: Riven (security) / Naomi (release). Board: Sora → Eve.

## 1. What has actually been done in this heartbeat

| Step | Result |
| --- | --- |
| Push remediation branch | `fix/sola-34-entitlements-remediation` pushed to `origin` (was local-only) |
| Merge to `main` | Merge commit `07a61a3` (`--no-ff`), tree byte-identical to `9fda81b` |
| Push `main` | `63fa157..07a61a3 main -> main` — **deploy.yml triggered** (run `36892189509`) |
| Verify ancestry | `9fda81b` is an ancestor of `main`; `git diff main fix/sola-34-entitlements-remediation` is empty |

The remediation commit `9fda81bd2a6216a7842de76c39ffb47406114079` is now on the
deployed branch. The previous heartbeat correctly reported it as impossible:
the git launcher was denying the operation with `No managed GitHub identity`.
This run the GitHub credential resolved and the push was permitted.

## 2. Live baseline (measured before the deploy landed)

```
GET  https://solaris.chr-z.dev/                      -> 200 text/html
GET  https://solaris.chr-z.dev/api/get-sheets-data    -> 200 text/html   (SPA shell!)
POST https://solaris.chr-z.dev/api/license/activate   -> 405, empty body
```

A `405` with no body is exactly the signature SOLA-34's deploy guard was written
to catch: Pages is serving static assets and the `functions/` directory is not
actually deployed. **`/api/*` is not live yet.** The first real deploy after the
merge is the one that introduces Functions, so its verification step matters.

## 3. Remaining blocker: Cloudflare account has no platform-reachable credential

The two live steps both need a Cloudflare credential:

1. `pages deploy` — holds in **GitHub Actions** (`CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`). GitHub Actions can use it; **agents cannot.**
2. KV binding / R2 / secret provisioning — needs the **Cloudflare provider MCP**.

The run's connection catalog reports Cloudflare as `ready`, but the connection
has `tokenBroker.enabled = false`, so `POST /api/agents/me/connections/{id}/token`
returns `403 broker_not_enabled` and the MCP exposes **no callable tools** to this
run. A `connection_request` returns `state: ready` and creates no card, because
the connection already exists — it is reachable by the board UI, not by the agent
runtime. `/api/cloud/stacks` returns `Cloud stack portfolio is unavailable`.

Net: **the credential is not usable from the agent runtime**, which is why this
issue keeps returning to the board. This is an account/permission condition, not
a missing instruction.

## 4. Exact remediation steps (each needs the Cloudflare credential)

### 4a. KV binding (`SOLARIS_LICENSE_KV`)

The adapters fail closed with `503 license_store_unconfigured` without it, and
`deploy.yml` asserts the binding and fails the deploy. Create a KV namespace and
bind it to the `solaris` Pages project for **both** production and preview:

```sh
# 1. Create the namespace
npx wrangler kv namespace create SOLARIS_LICENSE_KV
# => prints: id = "<ACCOUNT_KV_NAMESPACE_ID>"

# 2. Bind it to the Pages project (wrangler v3: use the dashboard, or
#    create/merge a wrangler.toml at the repo root):
```

```toml
# wrangler.toml (repo root) — NOT committed with a real id if the id is sensitive
name = "solaris"
pages_build_output_dir = "dist"

[[kv_namespaces]]
binding = "SOLARIS_LICENSE_KV"
id = "<ACCOUNT_KV_NAMESPACE_ID>"
preview_id = "<ACCOUNT_KV_NAMESPACE_ID>"
```

Either commit `wrangler.toml` (id is not a secret) or add the binding through the
Pages dashboard → Settings → Functions → KV namespace bindings. The binding must
be present **before** a deploy that is expected to pass the guard.

### 4b. Signing key (`sol-2026a`)

The committed public key is:

```
sol-2026a = Ly4Oo8LBgLEX2cCHiOo4OLpja01FiSi2LtwJ1cBXlTc
```

The matching private half was never provisioned (the `.pem` was deleted before a
deploy). Pending Paperclip secret proposal:
`c0c62da4-8f83-42a3-91b1-c10da6ccd3c8` (`solaris/license-signing-key-pkcs8`) —
**it has no ciphertext**, so approving it cannot recover the key.

Two options:

- **Regenerate the pair** (recommended — deterministic, no lost material):
  ```sh
  node scripts/gen_license_keypair.mjs --kid sol-2026a --out ./keypair.json
  ```
  Public half → `src/licensing/keys.ts`; private half → Pages secret
  `SOLARIS_LICENSE_SIGNING_KEY_PKCS8` (base64url PKCS#8).
- **Recover the original** from the operator's backup, if one exists.

Also set on the `solaris` Pages project: `SOLARIS_LICENSE_KID=sol-2026a` and
`SOLARIS_PAYMENT_WEBHOOK_SECRET=<random>`. Until a signer is present the webhook
returns `501 signer_not_configured` and the happy path cannot be minted.

If the public key in `keys.ts` changes, `src/licensing/keys.ts` and any issued
tokens must be re-cut; keep `kid` stable for rotation.

## 5. Live happy-path exercise (must pass before this is done)

```sh
# 1. activate must be JSON, never the SPA shell, never license_store_unconfigured
curl -sS -o /tmp/b -w '%{http_code} %{content_type}\n' \
  -X POST -H 'content-type: application/json' -d '{"token":"x"}' \
  https://solaris.chr-z.dev/api/license/activate

# 2. mint a real token against the deployed ring, then unlock Pro end to end
node scripts/gen_license_key.mjs --kid sol-2026a --key ./keypair.json \
  --subject test-<something> --days 30 --grace-days 7
# 3. paste the token into the Pro unlock flow on https://solaris.chr-z.dev
```

The deliverable is the live site activating a real key **plus** confirmation that
`deploy.yml`'s JSON + KV guards passed.

## 6. Rollback

Deployment-only, no migration. `git revert 07a61a3` restores the pre-merge tree;
removing the KV binding or the signer secret returns the adapters to their
fail-closed `503`/`501` states. No irreversible state was created by this change.

## 7. Security notes

- KV namespace **id** is not a secret; the API token is. Never commit `.env`,
  `.dev.vars`, `*.pem`, or the keypair file — `.gitignore` already covers them.
- The bundle guard (`scripts/check_bundle_secrets.mjs`) runs in CI and in
  `deploy.yml` and rejects private-key material in `dist`. This was proven on the
  first post-merge build; see the run log.
- Treat all webhook input as untrusted; the HMAC gate is required before parsing.
