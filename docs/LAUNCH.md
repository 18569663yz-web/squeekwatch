# LAUNCH — the first-88 runbook

The code track opens with four empty badges and 88 Early Buildooooor places.
Places are assigned **in verification order**, are **never reassigned**, and a disqualified
holder's place is **burned, not re-offered**. So the entire game is: be verified early, and
be verified *cleanly* — a failed attempt costs seconds you may not have, and a sloppy one
costs the place entirely.

This document is the executable version of that plan. Every command below is meant to be
pasted. Nothing here needs an install beyond `node` and `git`, plus `curl` (pwsh has
`Invoke-WebRequest` equivalents inline where it matters).

| Section | When |
|---|---|
| [1. Pre-flight (T-7 days)](#1-pre-flight-t-7-days) | before the track opens |
| [2. Accounts and access](#2-accounts-and-access) | T-7 and T-1 |
| [3. How to tell the track opened](#3-how-to-tell-the-track-opened) | T-0 |
| [4. The 90-second sequence](#4-the-90-second-sequence) | T-0 |
| [5. Result branches](#5-result-branches) | T-0, immediately after verify |
| [6. Rules we will not break](#6-rules-we-will-not-break) | always |
| [7. Second badge: The Tester](#7-second-badge-the-tester) | T-0 + 10 min |
| [8. Backup route: IMD](#8-backup-route-imd) | if the IMD route opens first |
| [9. Time budget](#9-time-budget) | T-0 |
| [10. After it lands](#10-after-it-lands) | T+5 min |

---

## 1. Pre-flight (T-7 days)

The 90 seconds only exist because everything else is already done. Do all of this a week
early, and re-check it on T-1.

### 1.1 Repository

- [ ] **Public GitHub repo**, default branch literally `main` (not `master`).
- [ ] Challenge file goes on the **default branch**. Verify: `git branch --show-current` → `main`,
      `git ls-remote --symref origin HEAD` → `ref: refs/heads/main`.
- [ ] `README.md` leads with what the project is and why it matters to Squeekchain. A verifier
      reads it; a bad first paragraph is a self-inflicted `mismatch` risk if you later rewrite it.
- [ ] `LICENSE` present (MIT), CI green, `node scripts/launch-checklist.mjs` exits 0.
- [ ] No secrets, no `.env`, no `node_modules` committed — a reviewer may open the repo during
      the window and a red flag is worse than being 20 seconds slower.
- [ ] A **demo deployment** on GitHub Pages (or any HTTPS static host) that works with zero
      backend, e.g. `https://<owner>.github.io/<repo>/`. Open it on a phone once.
- [ ] A **20-second GIF** of the dashboard + `audit` output for the tweet and the submission
      description. Keep it under 5 MB, record at 1280×720.

### 1.2 Submission copy (written in advance, pasted verbatim)

`name` — trimmed, 1–120 characters. Three candidates so a server-side rejection is survivable:

```
1. Squeekwatch — hamster economy observatory
2. Squeekwatch: PoW chain invariants + MCP
3. Squeekwatch
```

`integration` — trimmed, **20–1000 characters**, and this is the field a human/automated reviewer
reads. Our draft (≈ 610 chars, states only true things):

```
Squeekwatch is a zero-dependency Node.js observatory for the Squeekchain hamster economy. It
polls the public API and Sepolia RPC, then re-derives the economy's invariants locally: supply
identity against on-chain totalSupply, NFT live/burned identity, round monotonicity, settlement
queue consistency, telemetry freshness, and halving-schedule arithmetic. It ships a CLI, a static
dashboard, and an MCP server so agents (Claude, Cursor) can query chain state without trusting a
single endpoint. Everything is reproducible offline from recorded fixtures.
```

- [ ] Character count checked: `printf '%s' "$INTEGRATION" | wc -c` (must be 20–1000).
- [ ] `demoUrl` is `https://…`, ≤ 2048 chars, no trailing junk, opens in a private window.
- [ ] `repoUrl` is the exact `https://github.com/<owner>/<repo>` form (no `.git`, no query).

### 1.3 Know the failure modes before they happen

The API returns machine codes; the UI translates them. Codes observed in the official bundle:
`unsupported_repository_host`, `invalid_repository` (not a public GitHub repo),
`project_linked_elsewhere` (this repo is already attributed to another profile),
`invalid_job_reference`, `imd_job_not_found`, `imd_unavailable`, `imd_invalid_response`,
`payer_mismatch`, `payer_missing`, `rate_limited`. Each has a branch in
[§5](#5-result-branches) — read them once now, not at T-0.

---

## 2. Accounts and access

Do this at T-7, recheck at T-1.

- [ ] **Join Genesis** on `https://squeekchain.com` — verify the wallet (signature) and link X.
      A project can only be attributed to a Genesis profile; unjoined accounts cannot submit.
- [ ] Confirm on `https://squeekchain.com/genesis` that your profile shows
      `clout.signed_up`. If it does not, the submission has no owner and will fail.
- [ ] Log in to `https://community.squeekchain.com` in the **same browser** you will submit from.
- [ ] Capture the session token now, and know where it lives (it is a 43-character base64url
      string in `localStorage` under `squeek.community.session`):

  Browser console (on `community.squeekchain.com`):
  ```js
  JSON.parse(localStorage.getItem('squeek.community.session'))
  // { token: "<43 chars>", expiresAt: "2026-…" }
  ```

  ```bash
  # from DevTools → Network → any /v1/community request → Request Headers
  Authorization: Bearer <43-char token>
  ```

  Every write below sends `Authorization: Bearer $TOKEN`. If a call answers `401 unauthorized`,
  the token expired: re-login, re-capture, continue from the failed step — the project row is
  saved server-side, so an expired token never costs you the draft.
- [ ] `git`, `node` ≥ 20, `curl`, `jq` (or the pwsh `ConvertFrom-Json` variants below).
- [ ] GitHub token/PAT with `repo` scope in the environment so the push in step 4 never prompts:
      ```powershell
      $env:GITHUB_TOKEN = "ghp_…"   # used by the credential helper below, not stored in git
      ```
- [ ] Pre-warm git credentials once (`git config --global credential.helper manager`) so
      `git push` is a no-prompt operation.
- [ ] Squeekwatch checked out at the repo root, `git status` clean, `node scripts/launch-checklist.mjs`
      green.

---

## 3. How to tell the track opened

Three independent probes. Run them in a loop, or from a cron/Task Scheduler job every 60 s on
T-0. **Any one** of them flipping is the trigger — do not wait for all three.

### Probe A — the projects endpoint returns 200

Before launch it 404s or answers `{"error":"code_track_unavailable"}`-style; after launch it
returns a JSON list (`{projects:[…]}` or `[]`). The path itself is the signal.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://community.squeekchain.com/v1/community/code/projects
```

```powershell
(Invoke-WebRequest -Method GET -SkipHttpErrorCheck `
  -Uri 'https://community.squeekchain.com/v1/community/code/projects').StatusCode
```

### Probe B — the counters moved (or stayed at zero *after* A turned 200)

`projectsVerified: 0` plus a 200 on Probe A means the board is open and nobody has verified yet:
that is the exact moment to run. `projectsVerified > 0` means the window is already closing —
still run, but skip the GIF and the tweets.

```bash
curl -s https://community.squeekchain.com/v1/community/stats | jq -c '{projectsVerified, members, badgesEarned}'
```

```powershell
Invoke-RestMethod 'https://community.squeekchain.com/v1/community/stats' |
  Select-Object projectsVerified, members, badgesEarned
```

### Probe C — the page shows the button

The Genesis code page renders `Submit an independent project` only when the track is live.

```bash
curl -s https://squeekchain.com/genesis/code | grep -c 'Submit an independent project'
```

```powershell
$html = (Invoke-WebRequest 'https://squeekchain.com/genesis/code').Content
if ($html -match 'Submit an independent project') { 'OPEN' } else { 'closed' }
```

The bundle may be served lazily, so Probe C can lag Probe A. **Trust A.** Also watch the
official X account and Discord announcements; a human announcement is the slowest signal, not
the fastest.

> Ambiguity to expect: the stats document is cached for a while (`snapshot.computedAt` can lag
> minutes). `projectsVerified: 0` is therefore *not* proof that nobody has submitted — only that
> no verification has been counted yet. If Probe A is 200 and stats still says 0, assume you are
> racing and go.

---

## 4. The 90-second sequence

Set variables once, in the shell you will actually use.

**bash**

```bash
export CC='https://community.squeekchain.com/v1/community'
export TOKEN='<43-char token>'          # §2
export REPO_URL='https://github.com/<owner>/<repo>'
export DEMO_URL='https://<owner>.github.io/<repo>/'
export NAME='Squeekwatch: PoW chain invariants + MCP'
export INTEGRATION='<paste the §1.2 paragraph>'
export REPO_DIR='D:\squeek\squeekwatch'
```

**pwsh**

```powershell
$CC = 'https://community.squeekchain.com/v1/community'
$TOKEN = '<43-char token>'
$REPO_URL = 'https://github.com/<owner>/<repo>'
$DEMO_URL = 'https://<owner>.github.io/<repo>/'
$NAME = 'Squeekwatch: PoW chain invariants + MCP'
$INTEGRATION = '<paste the §1.2 paragraph>'
$REPO_DIR = 'D:\squeek\squeekwatch'
$HEAD = @{ Authorization = "Bearer $TOKEN"; 'Content-Type' = 'application/json' }
```

### Step 1 — create the project (≈ 6 s)

`POST /code/projects/independent` with `{name, integration, repoUrl, demoUrl?}`.
Response is `{project, challenge|null}`. The API schema allows `challenge` to be `null`; the UI
copy only ever describes the challenge path, so *when* it is null is **inferred** (a repo already
proven, or an IMD-only project) — if it is null, jump to step 7 and treat the project as pending
verification.

```bash
curl -sS -X POST "$CC/code/projects/independent" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg n "$NAME" --arg i "$INTEGRATION" --arg r "$REPO_URL" --arg d "$DEMO_URL" \
        '{name:$n, integration:$i, repoUrl:$r, demoUrl:$d}')" \
  | tee /tmp/sqk-create.json
```

```powershell
$body = @{ name = $NAME; integration = $INTEGRATION; repoUrl = $REPO_URL; demoUrl = $DEMO_URL } |
        ConvertTo-Json -Depth 4
Invoke-RestMethod -Method POST -Uri "$CC/code/projects/independent" -Headers $HEAD -Body $body |
  Tee-Object -Variable created | ConvertTo-Json -Depth 8
$created | Set-Content -Encoding utf8 "$env:TEMP\sqk-create.json"
```

What to check in the response, in this order: `project.id` (needed by every later call),
`project.attribution.status` (`pending` is normal), `challenge.path`, `challenge.text`,
`challenge.expiresAt`.

### Step 2 — extract `path` / `text` (≈ 3 s)

The challenge is the contract: *"Add this exact line to {path} on the default branch, then check
the verification."* The **path is authoritative from the response** — the UI copy shows
`.squeekchain/verification.txt` as an example, but never assume it; take `challenge.path`.

```bash
PROJECT_ID=$(jq -r '.project.id' /tmp/sqk-create.json)
CH_PATH=$(jq -r '.challenge.path'    /tmp/sqk-create.json)
CH_TEXT=$(jq -r '.challenge.text'    /tmp/sqk-create.json)
printf 'id=%s\npath=%s\ntext=%s\n' "$PROJECT_ID" "$CH_PATH" "$CH_TEXT"
```

```powershell
$j        = Get-Content -Raw "$env:TEMP\sqk-create.json" | ConvertFrom-Json
$PID_     = $j.project.id
$CH_PATH  = $j.challenge.path
$CH_TEXT  = $j.challenge.text
"id=$PID_"; "path=$CH_PATH"; "text=$CH_TEXT"
```

Sanity gate before writing anything: `CH_PATH` must be relative, must not contain `..`, and
`CH_TEXT` must be a single line. The helper in step 3 refuses unsafe input rather than writing
it — that refusal is a bug report, not an obstacle. Do **not** "fix" a path by hand; if the path
looks absolute or traversal-y, save the response, treat the verification as suspect, and say so.

### Step 3 — write the challenge line (≈ 2 s)

```bash
cd "$REPO_DIR"
node scripts/add-challenge.mjs "$CH_PATH" "$CH_TEXT"
```

```powershell
Set-Location $REPO_DIR
node scripts/add-challenge.mjs "$CH_PATH" "$CH_TEXT"
```

The helper is idempotent (re-running with the same line writes nothing and still exits 0),
creates parent directories, rejects absolute paths / `..` / symlink escapes, and refuses to
clobber a pre-existing file that lacks the line unless `--force`. It prints the exact git
commands for step 4.

### Step 4 — commit and push to the default branch (≈ 8 s)

The push *is* the proof; there is no other way for the verifier to see the line.

```bash
cd "$REPO_DIR"
git add -- "$CH_PATH"
git commit -m "Add Squeekchain repository verification challenge"
git push origin HEAD:main
SHA=$(git rev-parse HEAD)
echo "sha=$SHA"
```

```powershell
Set-Location $REPO_DIR
git add -- $CH_PATH
git commit -m "Add Squeekchain repository verification challenge"
git push origin HEAD:main
$SHA = (git rev-parse HEAD).Trim()
Write-Host "sha=$SHA"
```

Notes that save minutes:

- If `git push` is rejected because the remote moved, `git pull --rebase` then push again. Do
  **not** force-push a public repo during verification — a force-push is exactly the kind of
  change that turns a `verified` into a re-check.
- The commit must land on **the default branch**. `HEAD:main` is explicit on purpose.
- If the repo is a brand-new empty remote, `git push -u origin main` once before T-0 so the
  first real push is fast.

### Step 5 — pre-warm the raw CDN and confirm the file is really there (≈ 6 s)

Verifiers fetch the challenge file through `raw.githubusercontent.com`, which caches. Fetching it
yourself first removes the cache-miss race and, more importantly, **proves the file is visible
before you spend a verification attempt**.

```bash
RAW="https://raw.githubusercontent.com/<owner>/<repo>/$SHA/$CH_PATH"
curl -sSfL "$RAW" -o /tmp/sqk-raw.txt
grep -Fxq "$CH_TEXT" /tmp/sqk-raw.txt && echo "raw OK: line present at $SHA" || echo "RAW MISMATCH"
```

```powershell
$enc = [uri]::EscapeDataString(($CH_PATH -replace '\\','/'))
$RAW = "https://raw.githubusercontent.com/<owner>/<repo>/$SHA/$enc"
$raw = (Invoke-WebRequest -UseBasicParsing $RAW).Content
if ($raw -match [regex]::Escape($CH_TEXT)) { "raw OK at $SHA" } else { "RAW MISMATCH" }
```

If this prints `RAW MISMATCH`, stop: the file is not where the verifier will look, and a `verify`
call now can only produce `not_found`. Check branch, path case, and encoding first.

> A pinning-by-SHA URL is a convenience for *you*; the verifier reads the **default branch**,
> not your pin. Confirming the SHA URL works plus `git ls-remote origin main` matching `$SHA`
> covers both.

### Step 6 — verify (≈ 5 s)

```bash
curl -sS -X POST "$CC/code/projects/$PROJECT_ID/verify" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{}' | tee /tmp/sqk-verify.json
jq -r '.result, .project.attribution.status' /tmp/sqk-verify.json
```

```powershell
Invoke-RestMethod -Method POST -Uri "$CC/code/projects/$PID_/verify" -Headers $HEAD -Body '{}' |
  Tee-Object -Variable v | ConvertTo-Json -Depth 8
$v | Set-Content -Encoding utf8 "$env:TEMP\sqk-verify.json"
"result=$($v.result) attribution=$($v.project.attribution.status)"
```

`result` is one of `verified`, `not_found`, `mismatch`, `claimed_elsewhere`.
The request body is not documented in the bundle, so an empty JSON object (`{}`) is the
conservative choice; if the server rejects an empty body, the row is already saved and the UI's
own "check verification" button is the unblocking move.
If the response has no `challenge` and no `result`, the project was created but not verified —
[§5](#5-result-branches) explains each branch.

### Step 7 — archive and announce (≈ 5 s)

- [ ] Screenshot the verified project card **and** the badge row (`first 88` counter if shown).
- [ ] Save the two JSON bodies (`sqk-create.json`, `sqk-verify.json`) — they are the audit trail
      if a badge is ever revoked by mistake.
- [ ] Post on X: project link, one-line what it does, tag the official account, attach the GIF.
      Do not claim more than the badge states: verification proves *repository control*, not
      authorship, and the project says so itself.

Total: ≈ 35–40 s of machine time, inside a 90 s budget with retries.

---

## 5. Result branches

`POST /code/projects/:id/verify` → `{project, result}`.

| `result` | Meaning | Do this | Attempts |
|---|---|---|---|
| `verified` | Attribution proven. The Buildooooor + Early Buildooooor awarded; First Buildooooor if you were first. | Stop. Archive (§4 step 7). | — |
| `not_found` | The verifier could not see the file — usually CDN lag, wrong branch, or the push had not propagated. | Wait **15 s**, re-fetch the SHA raw URL, re-verify. Escalate to **45 s**, then **90 s**. Cap: 3 retries. Then check `git ls-remote origin main` equals `$SHA`; if it does, the file may be too new for the verifier's cache — wait one more minute and call verify again (that is not a new "attempt" in any cost sense we have observed, but the cap keeps the run honest). | ≤ 3 |
| `mismatch` | The file exists but the content does not match the challenge. | Diff what you wrote against `challenge.text`: BOM, CRLF/LF, a trailing space, the editor "fixing" the line, or `add-challenge.mjs` trimmed it. The verifier compares an exact line. Rewrite via `node scripts/add-challenge.mjs "$CH_PATH" "$CH_TEXT" --force`, commit, push, re-verify **once** more. If it still fails, stop and report — repeated mismatch attempts are how accidental-looking brute force starts. | ≤ 2 |
| `claimed_elsewhere` | This repository is already attributed to another profile (or another project row). | Do **not** retry. This is a duplicate-account/duplicate-repo signal. Switch to the backup repo (a *different* repository you control, if the case is genuinely a mis-attribution by a previous owner of that URL), or contact the team via Discord with the project id. If it means someone else claimed our repo, that is a support matter, not a race. | 0 |
| HTTP 401 `unauthorized` | Session token expired. | Re-login, re-capture token (§2), `POST /verify` again. The project row persists. | retry |
| HTTP 429 `rate_limited` | Too fast. | Back off **60 s** minimum (respect `retryAfterSeconds` if present), then retry the same call. Never parallelize verification calls. | ≤ 2 |
| HTTP 5xx / network | Server-side. | Back off 20 s, retry once, then treat as down and poll Probe A. | ≤ 2 |

Other creation-time errors and their meaning:

- `unsupported_repository_host` / `invalid_repository` — not a public GitHub repo, or the URL is
  malformed. Fix `repoUrl` to `https://github.com/<owner>/<repo>` and re-POST; the old row is
  harmless.
- `project_linked_elsewhere` — the repo is attributed elsewhere. Same as `claimed_elsewhere`.
- `invalid_job_reference` / `imd_job_not_found` / `payer_mismatch` / `payer_missing` — IMD route
  only, see [§8](#8-backup-route-imd).

**The challenge file stays.** Repositories are rechecked daily and removing the file revokes the
badge. Commit it forever; make it a documented part of the repo (this is why `add-challenge.mjs`
is idempotent and prints a human-readable next step).

---

## 6. Rules we will not break

The badge rules are published; the risk rules are not, which is why we take the conservative
reading.

1. **One person, one submission.** Wallets funded together are reviewed as one person. Multiple
   accounts, throwaway wallets, or two profiles racing each other is disqualification — and a
   disqualified holder's place is *burned*, so cheating costs a place that no one can reuse.
2. **One repository, one project.** Do not re-submit the same repo from another profile, and do
   not create project rows in bulk to "see what happens". A row you abandon still counts against
   duplicate detection.
3. **No fabricated attribution.** The verification proves *control of the repo*, not authorship.
   We will describe Squeekwatch as ours because it is ours; we will not copy someone else's repo,
   and we will not fork upstream work and claim it. This also protects the README/`integration`
   text: claims in it are reproducible from the code.
4. **No scraping / no hammering.** Polling every 60 s is fine; the API is public. Submissions are
   human-paced. Verification calls are serialized and capped.
5. **Respect `rate_limited`.** 60 s backoff, no parallel retries. If the endpoint pushes back
   twice in a row, stop for 5 minutes and watch Probe A — pressure does not create places.
6. **The demo and README must survive review.** No "placeholder" screenshots, no invented
   numbers, no unverified claims. Anything we cannot reproduce from the API or Sepolia RPC gets
   labelled as inference in the docs.

---

## 7. Second badge: The Tester

`code.the_tester` needs one rule: *"Send a transaction to a Squeekchain contract from one of
your verified wallets."* With one narrowing clause and one lag warning:

> *"Counts direct calls to the Squeekchain contracts we track on Sepolia; calls made through
> another contract don't count yet. Wallet activity is read on a schedule, so it can take a while
> to show."*

### Safest operation: `approve(stakingProxy, 0)` on SQK

This sets an existing allowance to zero. No tokens move, no value is transferred, state changes
are local to the allowance mapping. On Sepolia it costs testnet gas and nothing else.

- Token (SQK, 18 decimals): `0x5501e1fa81be1c3f49225fa7668da0245d07db60`
- Spender (staking proxy): `0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f`
- Function: `approve(address spender, uint256 amount)` → selector `0x095ea7b3`
- Calldata: `0x095ea7b3` + `000…0004b67b739dfd832f4eac67a7aa3bc244fb74cea4f` (32 bytes) +
  `000…0000` (32 bytes, zero)

**Option A — wallet UI (recommended, zero tooling).**
Open `https://sepolia.etherscan.io/address/0x5501e1fa81be1c3f49225fa7668da0245d07db60#writeContract`
→ *Connect to Web3* with the Genesis-verified wallet → `approve` → spender
`0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f`, amount `0` → Write → confirm. The transaction
is sent **directly from your wallet** to the token contract, which is exactly what the badge
counts.

**Option B — Foundry `cast` (if installed).**

```bash
cast send 0x5501e1fa81be1c3f49225fa7668da0245d07db60 \
  "approve(address,uint256)" 0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f 0 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --private-key "$SEPOLIA_KEY"
```

```powershell
cast send 0x5501e1fa81be1c3f49225fa7668da0245d07db60 `
  "approve(address,uint256)" 0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f 0 `
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key $env:SEPOLIA_KEY
```

**Option C — Squeekwatch's own encoder** (no transaction, just the calldata to paste into any
wallet's "custom transaction" screen, e.g. Rabby's advanced send):

```bash
node -e "import('./src/contracts.js').then(m=>console.log(m.encodeApproveZero('0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f')))"
# 0x095ea7b30000000000000000000000004b67b739dfd832f4eac67a7aa3bc244fb74cea4f0000…0000
```

### Verification and risks

- [ ] Wait for the tx receipt (`status: 1`), then check `https://squeekchain.com/genesis` badge
      row. Badge reads are scheduled, so allow minutes, not seconds — do not re-send to "make it
      appear". Re-sending does nothing except spend gas.
- [ ] If it has not appeared after ~30 minutes, check that the wallet is the **verified Genesis
      wallet** (not a second wallet), and that the call was sent directly (a call routed through a
      smart-account or multisig contract may not count — "calls made through another contract
      don't count yet").
- Intentionally choosing a no-op (approve 0) rather than a real deposit is deliberate: it proves
  the wallet interacts with the contract without moving funds or depending on undocumented
  staking minimums.

---

## 8. Backup route: IMD

If the independent/GitHub route is delayed but the IMD route opens (the bundle exposes
`POST /code/preview/imd` and `POST /code/projects/imd`), the flow changes shape:
the proof is a **paid job on `imd.fun` from a wallet verified on your Genesis profile**, not a
repository challenge.

Order of operations:

1. **Preview first** — this tells you whether the job is linkable before you spend anything:
   ```bash
   curl -sS -X POST "$CC/code/preview/imd" -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"job":"<job reference>"}'
   ```
   Response includes `externalId`, `name`, `repoUrl`, `demoUrl`, `imd`, `attribution`
   (`verified` | `mismatch` | `missing`), `payer`, `matchedWallet`, `existingProjectId`,
   `linkedElsewhere`. If `attribution` is `mismatch` or `linkedElsewhere`, stop — it will not
   become `verified` by retrying.

2. **Create the project** with the *same* `integration` copy as the GitHub route (it is the same
   project; never claim a different one):
   ```bash
   curl -sS -X POST "$CC/code/projects/imd" -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"job":"<job reference>","integration":"<the §1.2 paragraph>","name":"Squeekwatch"}'
   ```

3. **`payer_mismatch`** — the job was paid from a wallet that is not the one verified on your
   Genesis profile. Fix the *wallet*, not the payload: pay the next job from the verified wallet,
   then `POST /code/preview/imd` again with the new job reference. Do not try to swap the payer in
   the request; the field is server-derived.
   **`payer_missing`** — the job has no payer yet (unpaid). Pay it, then retry after the payment
   confirms.
   **`imd_unavailable` / `imd_invalid_response`** — upstream issue. Wait, poll Probe A.

4. Verifying an IMD project follows the same `POST /code/projects/:id/verify` call with the same
   result enum. The Buildooooor + Early Buildooooor badges do not care which route proved it.

If both routes are closed at T-0, do not improvise a third one (e.g. faking a repo). Keep polling
Probe A and publish the docs we already have; a delayed honest submission beats a burned place.

---

## 9. Time budget

| # | Step | Budget | Cumulative | Notes |
|---|---|---|---|---|
| 1 | `POST …/independent` | 6 s | 6 s | one call; keep body in a variable |
| 2 | parse `id` / `path` / `text` | 3 s | 9 s | `jq`; sanity-gate before writing |
| 3 | `add-challenge.mjs` | 2 s | 11 s | idempotent; exits 0 if already present |
| 4 | `git add/commit/push`, `rev-parse` | 8 s | 19 s | no prompt; `HEAD:main` |
| 5 | pre-warm raw + SHA check | 6 s | 25 s | catches `not_found` before it costs a retry |
| 6 | `POST …/verify` | 5 s | 30 s | the only step that can fail for reasons you can't see |
| 7 | screenshot + tweet draft | 10 s | 40 s | parallel with waiting, not blocking |
| — | retry cushion | 50 s | 90 s | up to 3 slow `not_found` retries |
| 8 | The Tester tx (separate, +10 min) | — | — | do not do this in the 90 s window |

The 90 seconds are not a challenge to shave — they are the margin that turns a CDN hiccup into a
retry instead of a lost place.

---

## 10. After it lands

- [ ] Keep the challenge file and the commit hash; both are evidence if attribution is rechecked.
- [ ] Watch for the daily recheck: if the file is ever removed by a cleanup, the badge is revoked.
      Add it to `.gitignore`? **No** — the opposite: keep it committed and never rewritten.
- [ ] Update `docs/BADGES.md` holder counts once the API reflects your verification (there is a
      snapshot cache; re-fetch after a minute).
- [ ] The tweet should contain: repo link, demo link, one-sentence what it verifies, the GIF,
      and the official account tag. No "first!" framing beyond what the badge states.
- [ ] If a second project is contemplated later: one profile, one repo, one verification — do not
      turn a win into a duplicate-detection case.
