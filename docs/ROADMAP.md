# Elixir Books ERP — Delivery Roadmap & Plan (Draft v0.1)

> **Status:** First draft for review · **Prepared:** 30 Sep 2026 · **Proposed start:** Mon 5 Oct 2026
> **Sources:** `src/imports/elixir-books-{brd,prd,frd}__2_.md`, `docs/ARCHITECTURE.md`,
> `docs/INTEGRATION-FINDINGS.md`, `docs/api/` (OpenAPI contract)

---

## 1. Where we are today

The product is a **complete, clickable front-end prototype** — not yet a production system.

| Area | State | Evidence |
|---|---|---|
| Front end (React 19 + Vite) | ✅ ~19 modules, ~214 routes, all flows working against an in-browser store | `src/modules/*` (~40k lines), `pnpm smoke` |
| Business rules | ✅ Prototyped in the browser (posting, tax, stock, open items, FX, workflow, numbering) | `src/store/engine.ts` (1.4k lines) |
| Demo data & accounting integrity | ✅ Balanced TB, AR/AP/inventory control accounts reconcile | `scripts/audit-seed.mts`, `INTEGRATION-FINDINGS.md` |
| API contract | ✅ 905 operations / 653 paths / 29 webhooks, derived from the code | `docs/api/openapi.yaml` |
| **Backend (NestJS + PostgreSQL)** | ❌ Not started | — |
| **Persistence, auth, tenant isolation (RLS)** | ❌ Browser `localStorage` only | `src/store/db.ts` |
| **Statutory integrations** (IRP e-invoice, e-way bill, GSTN, bank files) | ❌ Simulated | `src/modules/taxation` |
| Automated tests (unit / API / isolation) | ⚠️ Playwright walkthroughs + seed audit only | `scripts/` |
| Hosting, CI/CD, monitoring, backups | ❌ Not started | — |
| Known functional gap | ⚠️ Runtime COGS not posted by sales/POS actions | `INTEGRATION-FINDINGS.md` §"Deliberately left" #3 |

**What "complete this version" means:** take the prototype to a **production v1.0** — real backend,
real database, secure multi-tenant login, statutory integrations for India, tested and hosted — and go
live with pilot customers in stages, following the PRD's Release 1–7 order.

The good news: UX, flows, business rules and the API contract are already designed. Most of the
remaining work is **backend + integration + testing + go-live**, which lets functional/BA staff
work in parallel on test cases, decisions and UAT from day one.

---

## 2. Team & roles

| Role | Count | Primary responsibilities | Allocation |
|---|---|---|---|
| **Developer (junior–mid)** — *Dev A, "Platform & Finance"* | 1 | Backend scaffold, auth, tenancy/RLS, accounting/posting engine, tax engine, banking, deployment | 100% |
| **Developer (junior–mid)** — *Dev B, "Operations & Integration"* | 1 | Masters, sales, inventory, purchase, POS, FE ↔ API wiring, statutory/GSP integrations | 100% |
| **Functional consultant** — *F1, "Finance & Tax"* | 1 | Accounting, GST/TDS, banking, payroll, FA, close; golden test scenarios; UAT lead for finance | 100% |
| **Functional consultant** — *F2, "Supply Chain & Ops"* | 1 | Sales, purchase, inventory, POS, projects, manufacturing; golden scenarios; UAT lead for ops | 100% |
| **Business Analyst** | 1 | Product owner proxy, backlog & acceptance criteria, decision register, release notes, user docs, pilot customer liaison | 100% |
| **Intern** — *I1, "QA automation"* | 1 | Playwright E2E, API tests (from OpenAPI examples), regression suite, bug triage support | ~40% productive |
| **Intern** — *I2, "Data & docs"* | 1 | Import templates, migration scripts, seed/test data, help articles, screenshots/training material | ~40% productive |

### Gaps in the team — recommended mitigations

| Gap | Risk | Mitigation (pick at least one) |
|---|---|---|
| No senior engineer / architect | Weak decisions on RLS, posting atomicity, money precision are expensive to undo | **Part-time senior reviewer (4–6 h/week)** for architecture + PR review of the posting engine, auth and RLS. Highest-value spend in this plan. |
| No dedicated QA | Regressions in accounting are costly | Functional consultants own test cases & UAT; I1 automates them; financial invariants run in CI |
| No DevOps | Go-live, backups, monitoring | Use **managed services** (Azure Container Apps + Azure Database for PostgreSQL Flexible) instead of Kubernetes for v1; Dev A owns infra-as-code |
| No UX designer | — | Not needed: design system + all screens exist |

### Capacity assumption

| | Per sprint (2 weeks) |
|---|---|
| 2 devs × 10 days × ~70% focus | ~14 dev-days |
| 2 interns × 10 days × ~35% effective | ~7 dev-days |
| **Total delivery capacity** | **~21 dev-days / sprint** |
| After pilot go-live (from S13) | reserve ~20% for production support → **~17 dev-days** |

AI coding assistants are assumed for boilerplate (CRUD modules, DTOs from OpenAPI, tests) — this is
what makes the plan feasible with two junior–mid developers. Without them, add ~30–40% to every phase.

---

## 3. Guiding principles

1. **Release by value, not by module** — follow the PRD order (Foundation → Accounting & Sales MVP → …).
2. **Pilot early:** first paying/pilot customers go live on **1 Apr 2027**, the start of Indian FY 2027-28
   (clean opening balances, no mid-year migration).
3. **Contract-first:** the OpenAPI contract in `docs/api` is the spec. Backend implements it; front end
   switches from the in-browser store to the API one module at a time behind a data-access adapter.
4. **Port, don't rewrite, business rules:** `src/store/engine.ts` is TypeScript already — move it into
   NestJS domain services with exact decimal money (no floats) and database transactions.
5. **Financial invariants are release gates:** balanced journals, TB = 0, AR/AP/inventory control =
   sub-ledger, no negative stock, tenant-isolation negative tests — automated, in CI, every PR.
6. **Descope before slipping:** each phase lists "can defer" items.

---

## 4. Timeline at a glance

2-week sprints, starting **Mon 5 Oct 2026**. ~34 sprints ≈ **16 months to v1.0 GA (Jan 2028)**.

```
2026         Oct        Nov        Dec        Jan'27     Feb        Mar        Apr        May        Jun
Phase 0/1    [S1──S4 Foundation ]
Phase 2                         [S5──────S9 Accounting + Sales MVP]
Phase 2b                                                [S10─S11 UAT/Harden]
Pilot                                                              [S12 prep]★ 1 Apr go-live
Phase 3                                                            [S12────S15 Inventory + full Sales]
Phase 4                                                                                 [S16──S19 Purchase + Banking]

2027         Jul        Aug        Sep        Oct        Nov        Dec        Jan'28
Phase 5      [S20────S23 GST compliance + POS]
Phase 6                           [S24────S27 Enterprise finance + Reports]
Phase 7                                               [S28──────S32 Services + Manufacturing]
GA                                                                          [S33─S34]★ v1.0 GA
```

### Milestones

| # | Milestone | Date | Exit criteria |
|---|---|---|---|
| M0 | Kick-off & decisions frozen for R1–R2 | 16 Oct 2026 (end S1) | Section 8 decisions D1–D8 signed off; env + CI running |
| M1 | **Foundation (R1) done** | 27 Nov 2026 (end S4) | Admin can securely onboard a multi-branch org on the real backend |
| M2 | **Accounting & Sales MVP (R2) feature-complete** | 5 Feb 2027 (end S9) | Invoice → receipt → reconciled TB/GST summary on real backend |
| M3 | UAT sign-off + pilot readiness | 5 Mar 2027 (end S11) | No Sev-1/2 open, backup/restore tested, 2–3 pilot tenants onboarded in staging |
| M4 | ★ **Pilot go-live** (services / simple-goods companies) | **1 Apr 2027** | Pilot tenants transacting in production from FY 2027-28 |
| M5 | Inventory & full Sales (R3) live | 30 Apr 2027 (end S15) | Order-to-cash with stock |
| M6 | Purchase & Banking (R4) live | 25 Jun 2027 (end S19) | Procure-to-pay + bank reconciliation |
| M7 | GST compliance + POS (R5) live | 20 Aug 2027 (end S23) | Live IRP/EWB via GSP, GSTR-1/3B preparation, POS in pilot store |
| M8 | Enterprise finance (R6) live | 15 Oct 2027 (end S27) | Payroll accounting, FA, budgets, full reports, consolidation |
| M9 | Services + Manufacturing (R7) feature-complete | 10 Dec 2027 (end S31) | Profiles, projects billing, MRP & production orders |
| M10 | ★ **v1.0 General Availability** | **21 Jan 2028** (end S34) | PRD §15.1 release definition of done met across all modules |

---

## 5. Phase-by-phase plan

API operation counts come from `docs/api/README.md` to size the work.

### Phase 0 + 1 — Mobilise & Foundation (R1) · S1–S4 · 5 Oct – 27 Nov 2026

**Goal:** real backend skeleton + secure multi-tenant onboarding.
**Scope (≈ Auth 22 · Admin ~60 · Platform 16 · System 16 · Masters ~70 ops)**

| Workstream | Owner | Work |
|---|---|---|
| Architecture & setup | Dev A (+ senior reviewer) | NestJS monorepo (`api`, `worker`), PostgreSQL + Prisma/Drizzle, migrations, RLS by `tenant_id`, Redis/BullMQ, money as decimal/minor units, correlation IDs, error model per `openapi.yaml`, CI (typecheck, lint, test, build), staging env on Azure |
| Identity | Dev A | Login, JWT/refresh, invitations, password reset, MFA (TOTP), sessions, roles & `<module>.<resource>.<action>` permissions, entitlement |
| Organisation | Dev B | Tenant, company, branch, FY & periods, currencies, tax registrations, number series, audit log, attachments (Azure Blob), notifications |
| Masters | Dev B + I2 | Generic CRUD pattern (generated from OpenAPI) → customers, suppliers, items, UOM, HSN/SAC, tax rates, payment terms, price lists, warehouses; import wizard backend |
| Front-end wiring | Dev B | Introduce `src/api/` client + adapter so `useCollection`/`useRecord` can read from API per module (feature flag: `local` vs `api`) |
| Quality | I1 | API test harness from OpenAPI examples; tenant-isolation negative test suite (release-gating, NFR-05) |
| Functional | F1, F2, BA | Close decisions D1–D8; write R1/R2 acceptance criteria and golden scenarios (E2E-01, E2E-04); onboarding checklist content |

**Can defer:** SSO/SAML, API keys, platform billing automation, custom fields.

### Phase 2 — Accounting & Sales MVP (R2) · S5–S9 · 30 Nov 2026 – 5 Feb 2027

**Goal:** a service or simple-goods company can invoice, collect and produce reconciled books.
**Scope (≈ Accounting 40 · Sales ~35 · Reports ~15 · Approvals 5 · Taxation ~8 ops)**
*S6–S7 cover the year-end holidays — planned at ~70% capacity.*

| Workstream | Owner | Work |
|---|---|---|
| Posting engine | Dev A | Port `engine.postJournal / reverseJournal / accountBalance / postingCheck / allocateNumber` into DB transactions with idempotency keys + outbox; period lock (`423`) |
| Accounting | Dev A | COA, dimensions, manual journals (draft → approve → post → reverse), opening balances, GL, day book, trial balance, customer ledger |
| Tax engine (GST) | Dev A + F1 | `computeDocument` + `taxContextFor` server-side: CGST/SGST/IGST, place of supply, HSN/SAC, rounding; tax summary report |
| Sales MVP | Dev B | Direct sales invoice (draft/approve/post/cancel/reverse), credit notes (basic), receipts + allocation, open items, customer outstanding; sales register |
| Documents | Dev B + I2 | Server-side PDF (invoice template), e-mail sending, attachment links |
| Workflow | Dev B | Approval rules for Sales Invoice & Journal; approvals inbox API |
| Quality | I1 + F1 | Accounting golden scenarios automated; invariants suite (port `audit-seed.mts` checks to run against the DB) |
| Fix known gap | Dev B | Post runtime COGS journal on delivery/invoice/POS (INTEGRATION-FINDINGS #3) — built into the server-side posting from day one |

**Can defer:** multi-currency (INR-only MVP), recurring journals, intercompany, advanced approval designer.

### Phase 2b — Hardening, UAT, pilot readiness · S10–S12 · 8 Feb – 19 Mar 2027

| Workstream | Owner | Work |
|---|---|---|
| UAT rounds 1 & 2 | F1, F2, BA | Scripted UAT with pilot customers' real sample data; defect triage daily |
| Fixes & performance | Dev A, Dev B | Sev-1/2 fixes; indexes; p95 read < 500 ms, write < 1 s (NFR-02) |
| Operations | Dev A | Production env, backups (RPO ≤ 15 min), restore drill, Sentry + OpenTelemetry, alerts, runbook |
| Security | Dev A + senior reviewer | Dependency/vuln scan, OWASP checklist, secrets in Key Vault, pen-test-lite |
| Migration | I2 + F1 | Opening balance / masters import templates (Tally/Excel), dry runs for each pilot |
| Enablement | BA + I2 | User guide for MVP flows, training videos, support process & SLA |
| R3 start | Dev B (S12) | Warehouse & stock ledger backend begins in S12 |

**★ Pilot go-live: Thu 1 Apr 2027** — hypercare for 2 weeks (devs 50% on support during S13).

### Phase 3 — Inventory & full Sales (R3) · S12–S15 · 8 Mar – 30 Apr 2027

**Scope (≈ Inventory 42 · Sales remaining ~45 ops)**
- Warehouses, stock opening, stock ledger, moving-average valuation, adjustments, transfers, counts, batches/serials.
- Quotation → sales order (credit check, reservations) → delivery (partial) → invoice; returns; AR ageing, statements, collections; CRM leads/activities (16 ops) if capacity allows.
- Golden scenario E2E-09 (trading lifecycle) automated.

**Can defer:** landed cost, replenishment suggestions, CRM pipeline board.

### Phase 4 — Purchase & Banking (R4) · S16–S19 · 3 May – 25 Jun 2027

**Scope (≈ Purchase 88 · Banking 35 ops)**
- Requisition → RFQ → PO → GRN (+QC) → vendor invoice with GRNI, 2/3-way match & duplicate detection → debit notes → payments → AP ageing.
- Bank/cash accounts, vouchers, statement import (CSV/Excel for 2–3 banks agreed in D12), reconciliation workbench, payment batches (maker-checker, bank file).
- Golden scenario E2E-02 (purchase-to-pay), E2E-03 (period close) automated.

**Can defer:** RFQ/award, 4-way match, bank APIs (file-based first), UTR auto-matching.

### Phase 5 — GST compliance & POS (R5) · S20–S23 · 28 Jun – 20 Aug 2027

**Scope (≈ Taxation 29 · POS 24 ops + provider integration)**
- **GSP integration** (vendor chosen in D10): e-invoice (IRN/QR), e-way bill, cancellation windows, retries & manual fallback (`502 PROVIDER_UNAVAILABLE`).
- GSTR-1 JSON, GSTR-2B import & ITC reconciliation, GSTR-3B preparation, TDS/TCS registers & returns data.
- POS terminal, shifts, split tender, hold/resume, returns, shift close — online-only for v1 (D13).
- Idempotency/concurrency scenario E2E-05 automated.

**Can defer:** offline POS, direct GSTN filing (export JSON for the CA to upload instead).

### Phase 6 — Enterprise finance & reporting (R6) · S24–S27 · 23 Aug – 15 Oct 2027

**Scope (≈ Payroll 37 · Fixed assets 21 · Budgets 31 · Reports 38 · Admin remaining ~40 ops)**
- Payroll: employees, structures, runs, payslips, statutory (PF/ESI/PT/TDS) and payroll journal; bank file.
- Fixed assets: register, capitalisation, depreciation runs (Companies Act + IT Act), disposals.
- Budgets, budget vs actuals, expense claims & reimbursements.
- Full financial reports as async jobs (P&L, BS, cash flow, CFO dashboard), saved reports, exports; multi-currency & FX revaluation; group consolidation (E2E-06, E2E-07).
- Advanced workflow designer, custom fields, webhooks (29 domain events), integrations page.

**Can defer:** consolidation eliminations/CTA, payroll statutory filing formats, forecasting.

### Phase 7 — Business profiles: Services & Manufacturing (R7) · S28–S32 · 18 Oct – 24 Dec 2027

**Scope (≈ Projects 66 · Production 76 ops)**
- Nature-aware onboarding (trading / services / manufacturing / hybrid) and profile-driven navigation.
- Services: contracts (fixed, T&M, milestone, retainer), timesheets, billing runs, revenue recognition, profitability (E2E-10).
- Manufacturing: BOM & routing (versioned), work centres, MRP, production orders (issue, output, scrap), QC, WIP & costing, subcontracting (E2E-11) — close the WIP reconciliation gap in `INTEGRATION-FINDINGS.md`.

**Can defer (most likely candidates if the plan slips):** subcontracting, genealogy, capacity planning, usage-based billing.

### GA hardening · S33–S34 · 27 Dec 2027 – 21 Jan 2028

Full regression, performance/capacity test at agreed scale profile (D15), security review, DR drill,
documentation complete, sign-offs per PRD §15.1 → **v1.0 GA**.

---

## 6. Effort check (does it fit?)

| Phase | Sprints | Capacity (dev-days) | Rough estimate (dev-days) | Fit |
|---|---|---|---|---|
| 0/1 Foundation | 4 | 84 | 85–95 | ⚠️ tight — senior reviewer + generated CRUD needed |
| 2 Accounting & Sales MVP | 5 (2 at 70%) | ~92 | 90–100 | ⚠️ tight — multi-currency deferred |
| 2b Hardening / UAT | 2 + part of S12 | ~50 | 40–50 | ✅ |
| 3 Inventory & Sales | 4 (S13 at 50%) | ~60 | 60–70 | ⚠️ defer landed cost/CRM if needed |
| 4 Purchase & Banking | 4 | ~68 | 70–80 | ⚠️ defer RFQ, 4-way match |
| 5 Compliance & POS | 4 | ~68 | 60–70 | ✅ (GSP SDK dependency) |
| 6 Enterprise finance | 4 | ~68 | 75–90 | ❌ over — pick deferrals up front |
| 7 Services & Manufacturing | 5 (S32 holidays) | ~80 | 100–120 | ❌ over — likely split into 7a Services (GA) / 7b Manufacturing (post-GA) |
| GA hardening | 2 | ~34 | 30–35 | ✅ |

**Honest read:** R1–R5 (everything an Indian trading/services SME needs) fits by **Aug 2027**.
R6–R7 are where two junior–mid developers run out of room. Two realistic options:

- **Option A (recommended):** GA in Jan 2028 with **Manufacturing moved to v1.1 (Q1 2028)**.
- **Option B:** keep full scope and add **one mid/senior developer from S20 (Jul 2027)** to hold the Jan 2028 GA.

---

## 7. How we work

| Cadence | What | Who |
|---|---|---|
| Daily (15 min) | Stand-up, blockers, defect triage | All |
| Sprint start (Mon, 1 h) | Planning — BA brings ready stories with acceptance criteria & golden examples | All |
| Mid-sprint (Wed wk 2) | Functional demo on staging → early feedback | Devs, F1, F2, BA |
| Sprint end (Fri, 1 h) | Review/demo + retro; release notes | All (+ pilot customers from S10) |
| Weekly (1 h) | Architecture/PR review of posting, auth, RLS changes | Dev A, Dev B, senior reviewer |
| Monthly | Steering: milestone status, risks, scope decisions | BA, sponsor |

**Definition of Ready (story):** API operation(s) identified in `docs/api`, acceptance criteria, at least
one worked accounting/tax example from F1/F2, permissions listed, decision dependencies closed.

**Definition of Done (story):** implemented against the contract · FE wired to API · unit + API tests ·
tenant-isolation test for new tables · invariants suite green · functional sign-off on staging · docs/help updated.

**Branching & environments:** `main` (protected) → `staging` (auto-deploy, UAT) → `prod` (tagged
releases). Feature branches + PR review (every PR reviewed by the other dev; posting/auth/RLS also by senior reviewer).

**Tooling:** Jira/Linear board with epics = PRD epics (EP-01…EP-22), labels = release (R1…R7);
Confluence/`docs/` for decisions; Sentry + OpenTelemetry for prod.

---

## 8. Decision register (needed from functional / BA / sponsor)

From FRD §25 and PRD §17. **A decision not closed by its "needed by" date blocks the sprint.**

| # | Decision | Owner | Needed by |
|---|---|---|---|
| D1 | MVP boundary: service-only vs basic stock items in R2 | BA + sponsor | S1 (16 Oct 2026) |
| D2 | Hosting (Azure Container Apps vs AKS), ORM choice, auth provider (self-built vs Entra/Auth0) | Dev A + senior | S1 |
| D3 | Pilot customers (2–3) and their profile (services / trading) | BA + sponsor | S1 |
| D4 | GSTIN/PAN validation service for onboarding | F1 | S2 |
| D5 | FY start vs books-beginning date semantics; opening balance approach | F1 | S2 |
| D6 | Branch-wise GST registration & numbering rules | F1 | S3 |
| D7 | Edition matrix, limits, pricing, trial/grace behaviour | BA + sponsor | S3 |
| D8 | Approval rules in R2 (material change, recall, self-approval) | F1 + BA | S4 |
| D9 | Data migration sources for pilots (Tally / Excel / Zoho) | F1 + I2 | S8 |
| D10 | **GST provider (GSP/ASP)** for e-invoice & e-way bill + fallback UX | F1 + Dev B | **S12** (contract lead time) |
| D11 | Valuation method(s), batch/serial scope, negative stock policy | F2 | S11 |
| D12 | Bank statement formats & banks for payment files | F1 | S14 |
| D13 | POS: online-only vs offline for v1 | F2 + BA | S16 |
| D14 | Multi-currency: supported currencies, rate provider, revaluation policy | F1 | S20 |
| D15 | Quantitative scale profile (tenants, docs/month, lines) for perf tests | BA + Dev A | S20 |
| D16 | Payroll statutory scope & confidentiality model | F1 | S21 |
| D17 | Consolidation standard, eliminations, CTA | F1 | S23 |
| D18 | Manufacturing depth (discrete/process, MRP, subcontracting) — or defer to v1.1 | F2 + sponsor | S24 |
| D19 | Data retention, archival, deletion & legal hold | BA + legal | S30 |

---

## 9. Top risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Junior–mid devs get core accounting/RLS design wrong | Med | High | Part-time senior reviewer; invariants + isolation tests in CI from S2; port proven `engine.ts` logic |
| Pilot date (1 Apr 2027) slips | Med | High | Freeze R2 scope at M2; multi-currency & advanced workflow already deferred; hardening sprints are protected |
| GSP onboarding/sandbox delays | High | Med | Sign GSP by S12; build against sandbox early; manual JSON export fallback |
| Decisions arrive late | High | Med | Decision register with "needed by" sprint; BA escalates at weekly steering |
| Production support eats feature capacity after go-live | High | Med | 20% support buffer from S13; rotate one dev on support per sprint |
| Floating-point money errors | Low | High | Decimal/minor-unit types enforced; lint rule; golden tests with paise rounding |
| Key-person dependency (only 2 devs) | Med | High | Pairing on posting engine, shared code ownership, ADRs in `docs/adr/` |
| Scope creep from pilot customers | High | Med | BA routes requests into backlog; only Sev-1/2 and legal compliance enter current sprint |

---

## 10. Immediate next steps (next 2 weeks — Sprint 1)

1. **Review this draft** with the team and sponsor; choose Option A or B (Section 6).
2. Confirm pilot customers (D3) and MVP boundary (D1).
3. Engage the part-time senior reviewer.
4. Dev A: scaffold NestJS + PostgreSQL + CI + staging; write ADRs for tenancy/RLS, money type, posting transaction.
5. Dev B: build the `src/api/` adapter and wire **one** module end-to-end (Masters › Customers) as the pattern.
6. F1/F2: write golden scenarios for E2E-01 (sales-to-cash) and E2E-04 (tenant isolation) with exact expected journals.
7. BA: set up the board (epics EP-01…EP-22, releases R1…R7), groom R1 backlog for S2.
8. I1: API test harness from OpenAPI examples. I2: import templates for customers/items/COA.

---

*Open questions on this draft: target sprint length (2 weeks assumed), public holidays calendar,
whether a senior reviewer/extra developer budget is available, and the pilot customers' profiles.*
