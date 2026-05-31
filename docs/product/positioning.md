# Positioning — datum/room

**Status:** draft (authored 2026-05-31, from a competitive scan of the 2026 UK
VDR market). Owner: Bradley. Companion to the
[brief](../briefs/ai-data-room.md) — the brief says _what_ we build; this says
_why we win_.

## One-line thesis

**The data room that answers back.** Incumbents store and lock documents and
help the _seller_ with AI (bulk redaction, bidder analytics). We help the
_reader_ — the vendor, buyer, or investor — get answers grounded in the
documents, with inline citations they can audit. Trust is the moat.

## Who we're for

The brief's wedge, sharpened: **B2B SMEs and scale-ups that get asked for
vendor-registration, security-posture, or RFP packs more than once a quarter** —
not Wall Street M&A desks. This segment is abandoned by the incumbents, who
optimise for high-end deal-making with per-deal pricing, sales-led onboarding,
and multi-day setup. Capital Pay is the first paying customer, at standard SaaS
pricing.

## The 2026 competitive landscape

Source: comparison data on datarooms.org.uk (2026 edition) plus provider
positioning. Treat ratings as indicative, not gospel.

| Provider                | Segment               | AI today                                                           | Table-stakes security                           |
| ----------------------- | --------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| Ideals                  | M&A / general         | Bulk AI redaction                                                  | ISO 27001, SOC 1/2/3, 8-level perms, fence view |
| Datasite                | M&A                   | AI redaction, diligence trackers                                   | SOC 2, ISO 27001, fence view                    |
| Intralinks              | M&A / banking         | AI deal analytics                                                  | Bank-grade, SSO, fence view                     |
| Ansarada                | M&A                   | Predictive bidder analytics (claims 97%), bulk AI redaction        | Strong; free pre-deal prep                      |
| Drooms                  | Real estate / EU      | "Drooms AI Assistant", AI redaction                                | GDPR (CH/DE hosting)                            |
| Imprima                 | M&A                   | AI redaction, translation, contract summarisation, bidder heatmaps | GDPR                                            |
| Dealroom                | M&A lifecycle         | AI contract analysis, diligence workflows                          | Standard                                        |
| Box                     | Generic content cloud | Box AI agents + multi-doc Q&A, 1,500+ integrations                 | Broad, not deal-specialised                     |
| Papermark               | Indie / open-source   | Doc sharing + tracking                                             | Lightweight                                     |
| HighQ (Thomson Reuters) | Legal                 | AI doc collaboration                                               | ISO 27001                                       |

**What everyone has (table stakes):** AES-256, granular permissions, 2FA/SSO,
audit trails, dynamic watermarking, fence-view screenshot prevention, OCR
search, NDA gates, custom branding, remote wipe.

## The four gaps we exploit

1. **AI serves the seller, not the reader.** Redaction and bidder heatmaps help
   the host. Almost nobody answers the external party's questions ("where's the
   cap table?", "what's your DR posture?") with grounded, cited responses. Our
   external-facing cited Q&A is the wedge.
2. **Auditable AI is rare.** Incumbent AI is mostly summarisation —
   hallucination-prone and untrusted in compliance contexts. Our inline
   citations + double access-filter + honest "I couldn't find this" is
   compliance-defensible in a way summarisation is not.
3. **The everyday pack use case is abandoned.** Per-deal pricing, sales-led,
   slow setup — all wrong for a quarterly vendor/RFP pack. We're self-serve,
   subscription-priced, minutes-to-value.
4. **Incumbent AI is reactive.** Our sense-check (flagging a wrong-folder upload
   _at upload time_) and checklist completion are _proactive_ quality gates —
   novel in the category.

## How we win (and where we must not lose)

**Lead with, and protect:**

- **Cited Q&A as the hero**, not a feature footnote. Every claim cited, every
  citation clickable to source, "I don't know" treated as a feature.
- **Auditable AI:** AI actions (FLAG/CLASSIFY) appear in the audit log;
  amber-everywhere "this is the AI talking" visual contract.
- **Speed-to-value:** opinionated fixed folder structure + AI checklist +
  sense-check = a populated, validated room in minutes.

**Fast-follow table stakes (absence loses deals even when our AI is better):**

- **Document redaction** — manual + AI-assisted. Currently absent from every
  spec (only _log_ redaction exists). See production-readiness register.
- **Watermarking + fence-view preview** — consciously Phase 2 today
  (`room-and-folders` NFR6, `access-control` exclusions). **Decision needed
  (see below).**
- **Security certification path** — ISO 27001 → SOC 2. Not at launch, but a
  visible roadmap item de-risks the buyer's procurement checklist.

## Open strategic decision — watermark / fence-view timing

The specs defer watermarking, fence-view, and DRM to Phase 2. That is correct
**if** we hold the line on the SME vendor/RFP/security-pack segment, where the
bar is "secure, permissioned, auditable" rather than "leak-proof DRM." It is
**wrong** if we chase regulated M&A, where their absence is a hard
disqualifier. Recommendation: stay Phase 2, stay in the SME lane, and revisit
only if pulled up-market by demand. **Needs Bradley's explicit call.**

## Two cautions

- The window to own "cited Q&A" is closing — Box agents and Drooms' assistant
  are already live. Move now.
- One hallucinated citation in a diligence context is reputationally fatal.
  The eval harness + strict citation validation in `ai-search-qna/design.md`
  is the right instinct — fund it as a first-class deliverable, not a nice-to-have.
