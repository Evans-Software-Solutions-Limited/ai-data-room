# ADR-013: Launch pricing — two published tiers, per-org with room caps

- **Status:** accepted (Bradley, 2026-07-16)
- **Date:** 2026-07-16
- **Deciders:** Bradley
- **Related:** [billing-subscription spec](../.kiro/specs/ai-data-room/billing-subscription/requirements.md) ·
  [brief](../docs/briefs/ai-data-room.md) (open question resolved) ·
  pricing research report (Claude research agent, 2026-07-16, cited
  sources within)

## Context

The brief left pricing open ("one simple plan at launch vs tiered?")
and the billing-subscription spec's FR1 carried placeholder numbers. A
2026-07-16 market scan established:

- **M&A-grade incumbents** (iDeals, Ansarada, Datasite, Firmex,
  ShareVault) cluster at **$5k–25k+/year**, all quote-gated — pricing
  opacity is a category norm buyers in our segment actively resent.
- **The segment we actually compete in** (DocSend data-room tier
  ~$250/mo, Digify ~£140–400/mo, Conveyor $9.6k/yr, SafeBase
  $7–15k/yr, Papermark ~€99/mo) publishes pricing and runs
  **~£70–400/month** self-serve up to ~$10–25k/yr for team-scale
  trust-center tools.
- **Pricing-psychology findings:** (a) in security/compliance tooling,
  price is a quality proxy — below roughly £79/mo trips a
  "too cheap to trust" signal with buyers doing due diligence on a
  regulated counterparty; (b) per-user pricing punishes the
  invite-many-external-reviewers workflow that is our core use case;
  (c) transparent pricing is itself a differentiator against the
  incumbents.

Caveat: several incumbent price points are cross-cited from aggregator
sites rather than vendor pages — directional, not exact.

## Decision

1. **Two published paid tiers + free trial. No permanent free tier,
   no "contact us" wall at launch.**
   - **Starter — £99/month** (annual: ~£990/yr, ≈2 months free):
     1 org, up to 3 active Opportunity subrooms, unlimited external
     invitees within date-expiry limits, NDA gate, audit log, AI
     features included under a fair-use quota.
   - **Business — £279/month**: unlimited subrooms, higher AI quota,
     multiple internal seats, priority support, custom NDA templates.
2. **Pricing axis: per-org base with subroom caps — never per-user.**
   External invitees are never billable seats.
3. **AI metering: generous in-plan quota, hard block at cap with an
   upgrade path.** No pay-per-call metering at v0.1 — SME buyers hate
   surprise usage bills and per-room Claude API costs are small.
   Metered overage is a Business-tier-only future option, framed as
   fair use.
4. **Annual discount ~15–20%**, offered alongside monthly. Push annual
   on anchor/enterprise deals.
5. **Anchor customer (Capital Pay) is priced as a negotiated annual
   contract in the £3,000–£8,000/year band — not a published tier.**
   Handled via the existing enterprise/custom back-door plan row
   (billing FR2/FR14), invoiced. A regulated fintech buying
   compliance-adjacent tooling has higher willingness-to-pay; a single
   logo must not anchor the public page.
6. **Positioning: publish pricing, and anchor marketing against the
   incumbents** ("vs $5k–25k/yr data rooms"), not against free
   file-sharing.

## Consequences

- Billing-subscription FR1 collapses from three placeholder plans to
  the two tiers above; the third self-serve tier ("Scale") is dropped
  at launch — revisit when self-serve demand outgrows Business.
- Exact quota numbers (AI checks / Q&A queries / grants per tier) are
  finalised in the billing slice's design phase within the principles
  above; the £99 / £279 price points and the per-org axis are fixed by
  this ADR.
- Stripe catalogue at launch: two products × (monthly + annual)
  prices, plus manual invoicing for the anchor contract.
- Billing can be deferred behind the Capital Pay pilot (manual
  invoice satisfies the "commercial customer" principle) without
  blocking the product slices.
- Supersede-don't-edit applies: any future pricing change gets a new
  ADR referencing this one.
