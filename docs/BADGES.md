# Badges — what exists, who holds one, and what is still open

Squeekchain's Genesis profile carries **14 badges** in two lanes. Ten are *clout* badges
(signup, invites, Discord), four are *code* badges (building). This page is the field guide to
all of them, with the live holder counts from the catalogue snapshot.

Source: `GET /v1/community/aura/badges`, captured `2026-10-28T17:42:17.322Z`
(1,159 members). Field meanings are documented in [PROTOCOL.md §2.2](PROTOCOL.md#22-get-v1communityaurabadges).

---

## 1. The short version

| | Value | Note |
|---|---|---|
| Badges defined | 14 | 10 `clout`, 4 `code` |
| Trophy badges | 3 | First Squeek, First Invitooor, First Buildooooor |
| Badges earned (all members) | 2,382 | equals the sum of every holder count (see §6) |
| Members | 1,159 | the rarity denominator: `heldByBps = holders / 1,159 × 10,000` |
| Code badges held | **0** | nobody has verified a project yet |
| Open code-badge places | **88** Early Buildooooor + 1 First Buildooooor + 1 Buildooooor + 1 Tester | |

Two lanes, one economy of attention:

- **`clout`** — membership and social reach: joining, linking Discord, inviting friends.
- **`code`** — building on Squeekchain: one verified project, one contract interaction, and the
  two place-based trophies for being first.

Trophies are cosmetic: *"A trophy for your profile — It shows on your profile but adds no
Aura."* They are still permanent (places are never reassigned), but they do not move the
leaderboard.

---

## 2. All 14 badges

Holder counts are live values at snapshot time. `bps` is basis points of the 1,159 members.

| # | id | Title | Lane | Trophy | Holders | bps | Open? |
|---|---|---|---|---|---|---|---|
| 1 | `clout.signed_up` | Signed Up | clout | no | 1,159 | 10,000 | everyone has it |
| 2 | `clout.on_discord` | On Discord | clout | no | 47 | 406 | open |
| 3 | `clout.the_invitooor` | The Invitooor | clout | no | 159 | 1,372 | open |
| 4 | `clout.the_recruitooor` | The Recruitooor | clout | no | 28 | 242 | open |
| 5 | `clout.the_ringleader` | The Ringleader | clout | no | 1 | 9 | open (1 held) |
| 6 | `clout.the_squeekfather` | The Squeekfather | clout | no | 10 | 86 | open |
| 7 | `clout.first_squeek` | First Squeek | clout | **yes** | 1 | 9 | **taken** |
| 8 | `clout.early_squeek` | Early Squeek | clout | no | 888 | 7,662 | **full (888/888)** |
| 9 | `clout.first_invitooor` | First Invitooor | clout | **yes** | 1 | 9 | **taken** |
| 10 | `clout.early_invitooor` | Early Invitooor | clout | no | 88 | 759 | **full (88/88)** |
| 11 | `code.project_submitted` | The Buildooooor | code | no | **0** | 0 | **open** |
| 12 | `code.the_tester` | The Tester | code | no | **0** | 0 | **open** |
| 13 | `code.first_buildooooor` | First Buildooooor | code | **yes** | **0** | 0 | **open** |
| 14 | `code.early_buildooooor` | Early Buildooooor | code | no | **0** | 0 | **open — 88 places** |

`clout.early_squeek` and `clout.early_invitooor` being exactly at their caps (888 and 88) while
the four code badges are at zero is the whole story of this page: the *established* side is
saturated, the *code* side is untouched.

---

## 3. What each badge asks for

Copy below is the catalogue's own `instruction` and `criteria` text, not our paraphrase.

| Badge | Requirement |
|---|---|
| Signed Up | Verify a wallet and link your X account. |
| On Discord | Link a Discord account from the Accounts card. One Discord account per member. |
| The Invitooor | One invited friend verifies a wallet and links X. |
| The Recruitooor | Five invited friends **with established X accounts** (created ≥ 1 year ago) complete signup. Newer accounts still count for The Invitooor, not this one. |
| The Ringleader | Twenty-five of the same established-X friends. |
| The Squeekfather | Three friends you invited each earn The Invitooor themselves. |
| First Squeek | First member to verify a wallet and link X. Trophy. |
| Early Squeek | One of the first 888 members to verify a wallet and link X. |
| First Invitooor | First member whose invited friend completed signup. Trophy. |
| Early Invitooor | One of the first 88 members whose invitation completed. |
| The Buildooooor | Verify one project: either an IMD project paid from a verified wallet, or a public GitHub repository proven with a challenge file. |
| The Tester | Send a transaction to a Squeekchain contract from a verified wallet. |
| First Buildooooor | First member to verify a project. Trophy. |
| Early Buildooooor | One of the first 88 members to verify a project. |

Every badge also requires **"Account in good standing"** — *"Not disqualified for abuse or
duplicate accounts. Wallets funded together are reviewed as one person."* That sentence is the
ethics rule, stated by the project itself: multiple accounts funded from one source are treated
as one person, and disqualification applies retroactively.

Place-based badges share the same permanence rule: *"Places go by when each member reached it
and are never reassigned: if a holder is later disqualified, their place stays empty. Team
accounts don't take places."* A disqualified holder does not open a slot — the slot is burned.

### Established accounts vs code lane

"Established" is not a lane. It is an **X-account age test** (≥ 1 year) applied only to
The Recruitooor and The Ringleader. Likewise "code" is not a status tier: it is the lane for
things you *build*, and both lanes feed the same aura pool and the same leaderboard.

---

## 4. The code lane, in detail

All four code badges are empty. That is the opportunity — and it is bounded and temporary.

### The Buildooooor — `code.project_submitted`

- **Holders:** 0. **Verification:** either an IMD job paid from a verified wallet, or a public
  GitHub repository proven with a challenge file.
- **What "verified" means:** *"Verification checks attribution, not quality; a verified project
  earns its badge."* And: *"A public GitHub repository is required. Repository control is
  proven with a challenge file; it does not claim authorship."*
- **Recheck:** *"Repositories are rechecked daily; removing the file revokes the badge."* The
  challenge file must stay on the default branch.
- **Prereqs:** Join Genesis (wallet verified + X linked); the project belongs to that profile.
- **Steps:** see [LAUNCH.md §4](LAUNCH.md#4-the-90-second-sequence).

### The Tester — `code.the_tester`

- **Holders:** 0. **Verification:** send a transaction to a Squeekchain contract from a
  verified wallet.
- **Narrowing clause:** *"Counts direct calls to the Squeekchain contracts we track on Sepolia;
  calls made through another contract don't count yet."* A read (`eth_call`) is not a
  transaction; only state-changing calls count, and only when sent directly by your wallet.
  Which contracts are tracked is not published — the eight addresses in
  [PROTOCOL.md §3.1](PROTOCOL.md#31-addresses) are the visible surface.
- **Lag:** *"Wallet activity is read on a schedule, so it can take a while to show."* Do not
  assume instant.
- **Safe operation:** a zero-value `approve(stakingProxy, 0)` on SQK changes allowance only —
  no tokens move, no value is transferred, and it costs Sepolia gas. Procedure in
  [LAUNCH.md §7](LAUNCH.md#7-second-badge-the-tester).

### First Buildooooor — `code.first_buildooooor` (trophy)

- **Holders:** 0. First member to verify a project. One place, never reassigned, adds no aura.

### Early Buildooooor — `code.early_buildooooor`

- **Holders:** 0. **88 places**, all empty: *"One of the first 88 members to verify a project."*
  This is the badge our launch plan targets. It is not a trophy, so it does add aura.

The ordering is therefore: one verification → The Buildooooor + Early Buildooooor (and First
Buildooooor if you are literally first). A single successful submission can carry three
badges.

---

## 5. Aura and the leaderboard

Aura is the points currency behind the leaderboard. What we know, and nothing more:

- `totalAura` across all members: **158,223** (`/v1/community/stats`).
- Leaderboard top 100 at snapshot: aura **698** (rank 100) to **2,939** (rank 1).
- Every one of those 100 entries has `tier: "gold"`; the only tier we have ever observed.
- Example profile `8mae44td`: 3 badges (`signed_up`, `on_discord`, `the_invitooor`),
  `aura: 0`, `tier: null` — so badges alone do not imply aura, and unranked profiles show zero.

**The aura weights are not published.** There is no formula in the API, and we will not invent
one: the difference between a clout badge and a code badge, the value of a trophy, the tier
thresholds, and the tie-break rule are all unknown (see
[PROTOCOL.md §4](PROTOCOL.md#4-what-we-could-not-verify)). What we can say is empirical: 7
badges correspond to ~2,939 aura at the top of the board, 4 badges to ~698 at rank 100, and
having badges without a rank yields 0.

---

## 6. The catalogue is internally consistent

A useful sanity check we run on every snapshot: `badgesEarned` must equal the sum of holder
counts.

```
1159 + 47 + 159 + 28 + 1 + 10 + 1 + 888 + 1 + 88 + 0 + 0 + 0 + 0 = 2382 ✓
```

and `stats.badgesEarned = 2382`. Two independently served documents agree, which is the least
we should expect before trusting either. Rarity math also checks out:
`47 / 1159 × 10,000 = 405.5 → 406 bps`, `888 / 1159 × 10,000 = 7,662 bps`, and
`1,159 / 1,159 × 10,000 = 10,000`. Squeekwatch's audit does not currently include a
badge-consistency invariant; this section documents why one would be cheap to add.

---

## 7. Why the zero matters

- Code badges: 0 of 4 held, 91 places (88 + 1 + 1 + 1) open.
- Established/clout places: all first/early places taken or full.
- `projectsVerified: 0` in `/v1/community/stats` — nobody has submitted yet, because the code
  track is not open (§ [LAUNCH.md §3](LAUNCH.md#3-how-to-tell-when-the-track-opens)).

When the track opens, every code badge is awarded in submission order. That is a genuine
first-mover window, and it closes as soon as 88 people verify. It is *not* a reason to
multi-account, reuse one repository across accounts, or fabricate attribution: the project
states that wallets funded together are reviewed as one person and that disqualified holders'
places stay empty. A revoked badge does not go to the next person, it is destroyed — cheating
costs the whole community a place.
