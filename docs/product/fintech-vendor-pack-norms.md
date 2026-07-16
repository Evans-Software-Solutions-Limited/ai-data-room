# Fintech vendor-pack document norms — checklist seed content

**Status:** reference (research output, 2026-07-16). Owner: Bradley.
**Consumers:** `room-and-folders` (canonical folder set),
`doc-checklist` (slot templates), `ai-doc-sensecheck` (expected
criteria per slot).

> Purpose: the evidence base for (a) the seventh canonical folder
> (`07_Information_Security`) added at room-and-folders sign-off and
> (b) the doc-checklist slot templates, replacing the earlier
> Curtis/SME dependency. Sourced from FCA outsourcing/operational-
> resilience guidance (SYSC 8, SYSC 15A, PS26/2 + FG26/4), Shared
> Assessments SIG (18 domains), CSA CAIQ (17 domains), SOC 2 /
> ISO 27001 evidence-pack guides, and PCI DSS AoC documentation.
> Triangulated across at least two sources per claim by the 2026-07-16
> research pass; citation URLs at the bottom.

## Why a seventh folder

Information Security is the largest single domain in both SIG and
CAIQ, and a payments-company reviewer looks for it **by that name**
first. Folding it into `06_Operations` buries the documents the
highest-stakes reviewers request most often.

## Expected documents per canonical folder

| Folder                    | Expected documents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01_Company_Overview`     | Certificate of incorporation; group/ownership structure chart; UBO disclosure; register of directors/shareholders; business licences; key management bios; org chart                                                                                                                                                                                                                                                                                                                                               |
| `02_Financials`           | Audited financial statements (last 2–3 years); latest management accounts / interims; credit report or reference; proof of capital adequacy/solvency; D&B or equivalent rating; tax-status forms (W-9/W-8 or UK equivalent)                                                                                                                                                                                                                                                                                        |
| `03_Commercial`           | Standard MSA / T&Cs; SLA definitions; pricing schedule; references / case studies; insurance certificates — general liability, **professional indemnity (FCA-mandated minimum for regulated UK firms)**, cyber / tech E&O; sanctions/PEP screening confirmation                                                                                                                                                                                                                                                    |
| `04_Product`              | Architecture / data-flow diagrams; subprocessor list; data-residency statement; product roadmap (ongoing-monitoring context); API / security documentation                                                                                                                                                                                                                                                                                                                                                         |
| `05_Legal`                | Signed NDA / confidentiality agreement; DPA + UK GDPR compliance statement; IP ownership / licensing terms; litigation / regulatory-action disclosure; sanctions and export-control attestations                                                                                                                                                                                                                                                                                                                   |
| `06_Operations`           | Business continuity plan + disaster recovery plan **with evidence of a recent test**; incident-response plan + past-incident disclosure; sub-outsourcing / fourth-party register; operational-resilience self-assessment (important-business-service mapping — explicit FCA expectation under SYSC 15A); employee background-check / vetting policy                                                                                                                                                                |
| `07_Information_Security` | SOC 2 Type II report (+ bridge letter if aged); ISO 27001 certificate + Statement of Applicability; **PCI DSS Attestation of Compliance** (expected of any vendor touching cardholder data); penetration-test summary / attestation (not the full report); vulnerability-scan summary; information-security policy; access-control policy; data retention / classification policy; encryption at-rest / in-transit attestation; security-awareness training evidence; completed **SIG Lite or CAIQ Lite** response |

## Fintech-specific sharpening (product hooks, not v0.1 scope)

- **FCA material third-party reporting** (PS26/2 / FG26/4, published
  March 2026, in force March 2027): regulated buyers must classify
  vendors as "material" and evidence the assessment. A checklist that
  maps uploads against FCA-materiality criteria is a defensible
  differentiator vs DocSend/Digify.
- **Safeguarding** (client-money segregation, FCA PS25/12) and PII
  minimum cover levels are payments-specific asks a generic
  Legal/Commercial label won't surface — candidate for an
  FCA-regulated-vendor checklist variant.
- SIG Lite / CAIQ Lite responses are increasingly maintained as a
  **standing, annually-updated document** — treating one as a
  first-class versioned artefact in `07_Information_Security` is a
  differentiation opportunity.

## Design decision recorded here (doc-checklist)

Per Bradley (2026-07-16): the canonical **folder set stays fixed in
code** (opinionated structure is the product bet; access-control,
doc-checklist, ai-doc-sensecheck, and ai-search-qna all key off the
fixed vocabulary). The **checklist templates within folders are
data-driven** — seeded from the table above — so vertical template
packs can vary without schema change; per-org template overrides are
Phase 2. This resolves the doc-checklist "Curtis-driven slot list"
open questions with no SME dependency (Curtis review becomes an
optional later validation pass).

## Sources

- FCA — outsourcing and operational resilience:
  <https://www.fca.org.uk/firms/outsourcing-and-operational-resilience>
- FCA — reporting material third-party arrangements:
  <https://www.fca.org.uk/firms/outsourcing-and-operational-resilience/reporting-material-third-party-arrangements>
- FCA — professional indemnity insurance:
  <https://www.fca.org.uk/firms/professional-indemnity-insurance>
- FCA PS25/12 — safeguarding:
  <https://www.fca.org.uk/publication/policy/ps25-12.pdf>
- Bitsight — CAIQ vs SIG:
  <https://www.bitsight.com/blog/caiq-vs-sig-top-questionnaires-vendor-risk-assessment>
- Peony — vendor due-diligence six-domain framework:
  <https://www.peony.ink/blog/vendor-due-diligence-checklist>
- Konfirmity — SOC 2 evidence collection:
  <https://www.konfirmity.com/blog/soc-2-evidence-collection-templates>
- Sprinto — security documents for due diligence:
  <https://sprinto.com/journey/compliance-readiness/what-security-documents-are-needed-for-due-diligence/>
- Thoropass — PCI DSS Attestation of Compliance:
  <https://www.thoropass.com/blog/pci-dss-attestation-of-compliance>
