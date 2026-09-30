# Pix payment → licence issuance binding (SOLA-6)

Status: **model implemented, not wired to production**. Pending independent
review (Riven — trust boundaries) and end-to-end validation (Naomi — states).
No real-money payment was attempted.

## 1. What the product had before this change (baseline)

`solaris-av-engine` @ `63fa157` ("move Solaris off Vercel to Cloudflare Pages"):

- **No payment flow of any kind.** No Pix, no BR Code, no PSP/gateway, no order
  table. `grep -riE 'brcode|emv|pix|cobran|mercadopago|gerencipe|efi|checkout'`
  over the tree (excluding `node_modules`/`.git`) returns only unrelated
  `pixel`/canvas hits.
- **Licence activation only, fully offline**: `src/licensing/core.ts`
  (+ `LicenseContext.tsx`, `ProUpgradeModal.tsx`). A signed key
  `SOLARIS-<v>-<expires>-<edition>-<payload>.<sig>` (HMAC-SHA256) is pasted by the
  user and verified in the browser.
- The Pro modal says only "delivered after purchase" — there is no purchase path.

Baseline reproduced today:

| Check | Command | Result |
| --- | --- | --- |
| Licence tests | `npx vitest run src/__tests__/licensing.test.ts` | **20/20 passed** |
| Typecheck | `npx tsc --noEmit` | **FAILS with pre-existing errors** (9 errors: `AnalysisWorkspace.tsx`, `DriveFilePicker.tsx`, `useAudioWaveform.ts`) |
| Node / npm | `node -v` / `npm -v` | v26.10.0 / 11.19.1 |

## 2. Search for "the newer chr-z Pix implementation validated by a bank"

Public inventory of github.com/chr-z (42 repos, fetched 2026-09-30):

- **`chr-z/pix-concilia`** — the only Pix-named repo. It **reconciles received
  Pix against orders** (offline, MIT, zero deps, 40 tests). Its own README is
  explicit: *"Não emite Pix"* (it does not emit Pix) and *"integração com
  OpenPix, BSPay, Mercado Pago etc. fica por sua conta"* (gateway integration is
  out of scope). It is **not** a BR Code (EMV® QRCPS) generator.
- No other chr-z repository emits Pix/BR Code; GitHub search
  `user:chr-z pix` returns exactly 1 result (`pix-concilia`).
- No local copy of a bank-validated BR Code emitter exists on this host
  (filesystem search for `br.gov.bcb.pix`, `crc16ccitt`, `BR Code`, `brcode`
  found only task prose, never code).

**Conclusion: the premise could not be substantiated from available assets.**
There is no accessible, bank-validated BR Code implementation to adapt. Per the
brief, we therefore **did not reimplement BR Code from memory**. Emitting a
copy-and-paste/QR payload remains blocked on either (a) the private/validated
implementation being provided, or (b) an approved PSP that returns the BR Code
(and confirms settlement authoritatively).

The one *reusable* validated asset is `pix-concilia`'s deterministic matching
rule order, which is adapted (with source attribution) into the confirmation
core below.

## 3. Model (order → confirmation → issuance → activation → delivery)

```
order(open) ──authoritative settlement──▶ confirmed ──▶ license_issued ──▶ activated ──▶ delivered
      │                                        │
      └────────────── cancelled ◀──────────────┘ (not after activation)
```

Trust boundaries:

- **Confirmation is only from an authenticated, auto-confirmable source**
  (`psp_webhook` or `bank_api` with `sourceVerified: true`). Screenshots, chat
  pastes and user assertions are not representable as a source kind, so they can
  never auto-confirm. `manual_import` is accepted as data but never
  auto-confirms.
- **Matching never guesses.** Rule order (adapted from chr-z/pix-concilia, MIT):
  exact `e2eId`/`txId` → `txId` in order reference → payer document + amount →
  payer Pix key + amount → unique amount among open orders. Ambiguity is
  reported, never resolved.
- **Amount is integer cents** on both sides; one-cent tolerance by default.
  A strong identifier does **not** waive the amount check before issuance.
- **Replay protection**: a settlement fingerprint (`source:e2eId|txId|eventId`)
  confirms at most one order.
- **Idempotent issuance**: `licenseIdempotencyKey(orderId)` is deterministic, so
  a retried webhook cannot mint a second licence.
- **Secrets stay server-side.** The binding emits a deterministic grant
  (`payload`, `idempotencyKey`); signing remains in the server-side licensing
  path. This module holds no secret and is not imported by the UI.

## 4. Files changed

| File | Change |
| --- | --- |
| `src/payments/types.ts` | New. Order/settlement/state-machine model, integer-cents + normalisation helpers. |
| `src/payments/confirm.ts` | New. `confirmSettlement` — deterministic, replay-safe confirmation. |
| `src/payments/issue.ts` | New. `bindPaymentToLicense` — idempotent payment→licence grant. |
| `src/payments/index.ts` | New. Public surface. |
| `src/payments/__tests__/paymentBinding.test.ts` | New. 26 tests. |
| `docs/pix-payment-binding.md` | New. This document. |

Additive only. No existing file modified; `src/licensing/*` and the shipped UI
are untouched, so product behaviour is unchanged.

## 5. Exact test results

```
npx vitest run src/payments                          → 26 passed (1 file)
npx vitest run src/__tests__/licensing.test.ts       → 20 passed (regression: unchanged)
npx tsc --noEmit | grep -i payments                  → no payments type errors
npx eslint src/payments --max-warnings 0             → clean
```

## 6. Findings for the other lanes

1. **Payment semantics are new, not repaired.** There was no Pix flow to
   replace. Any claim that a Pix flow was "fixed" would be false.
2. **(SOLA-5, Riven) Client-side HMAC secret.** `VITE_SOLARIS_LICENSE_SECRET`
   embeds the signing secret in the client bundle; `LicenseContext.tsx`
   acknowledges this. Entitlement can be forged by anyone who reads the bundle.
   This module deliberately does not depend on it, but the licence-issuance
   path must move verification server-side.
3. **(SOLA-5, Riven) Licence-key payload delimiter collision — reproducible P1.**
   `gen_license_key.mjs` base64url-encodes the payload, mapping `+` → `-`, but
   `parseLicenseKey` splits the body on `-` and requires exactly 5 segments.
   Any payload whose UTF-8 base64 contains `+` produces an unparseable key.
   Repro (ASCII, no exotic characters):

   ```
   payload = "order:>>>"   # e.g. a customer/order reference
   base64   = "b3JkZXI6Pj4+"
   b64url   = "b3JkZXI6Pj4-"        # '+' became '-'
   body     = "SOLARIS-1-0-pro-b3JkZXI6Pj4-"
   body.split("-").length === 6     # parser requires 5 → malformed
   ```

   A customer with such a reference can never activate. Fix (Riven's lane): use a
   payload alphabet that cannot emit `-`, or stop splitting on `-`.

## 7. Limitations & rollback

- No BR Code emission, no PSP integration, no bank confirmation, no settlement
  verification — those need a validated implementation/PSP.
- Matching heuristics are conservative but not cryptographic; they run *after*
  the trust gate.
- Rollback: delete `src/payments/` and `docs/pix-payment-binding.md`. Nothing
  else references them, so rollback is a clean revert of one commit.

## 8. Security implications

- Improves the trust boundary by making screenshot/assertion confirmation
  structurally impossible and by requiring an authenticated source.
- Does not fix the client-side signing secret (SOLA-5) — a forged entitlement is
  still possible until issuance/verification moves server-side.
- No secret, PII or real payment data is stored. Order/settlement objects are
  caller-supplied; treat all external fields (documents, keys, descriptions) as
  untrusted and normalized, never interpolated into queries or markup.
- **No real-money test was performed** and none may be without owner approval.
