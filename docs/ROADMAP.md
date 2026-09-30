# Elixir Books ERP — Delivery Roadmap & Plan (Draft v0.2)

> **Status:** Draft for review · **Prepared:** 30 Sep 2026 · **Proposed start:** Mon 5 Oct 2026
> **Sources:** `src/imports/elixir-books-{brd,prd,frd}__2_.md`, `docs/ARCHITECTURE.md`,
> `docs/INTEGRATION-FINDINGS.md`, `docs/api/` (OpenAPI contract)
>
> **v0.2 changes:** 2-week sprints confirmed · no holiday calendar applied · no extra hires or
> external reviewer — two timelines instead: **with** vs **without** 2 × Claude Code Max plans ·
> pilot users are **internal users of the older Elixir Books v1**, so a v1 → v2 migration track is added.

---

## 1. Where we are today

The product is a **complete, clickable front-end prototype**, not yet a production system.

| Area | State | Evidence |
|---|---|---|
| Front end (React 19 + Vite) | ✅ ~19 modules, ~214 routes, all flows working against an in-browser store | `src/modules/*` (~40k lines), `pnpm smoke` |
| Business rules | ✅ Prototyped in the browser (posting, tax, stock, open items, FX, workflow, numbering) | `src/store/engine.ts` (1.4k lines) |
| Demo data & accounting integrity | ✅ Balanced TB; AR/AP/inventory control accounts reconcile | `scripts/audit-seed.mts`, `INTEGRATION-FINDINGS.md` |
| API contract | ✅ 905 operations / 653 paths / 29 webhooks, derived from the code | `docs/api/openapi.yaml` |
| **Backend (NestJS + PostgreSQL)** | ❌ Not started | — |
| **Persistence, auth, tenant isolation (RLS)** | ❌ Browser `localStorage` only | `src/store/db.ts` |
| **Statutory integrations** (IRP e-invoice, e-way bill, GSTN, bank files) | ❌ Simulated | `src/modules/taxation` |
| **Migration from Elixir Books v1** | ❌ Not started | — |
| Automated tests (unit / API / isolation) | ⚠️ Playwright walkthroughs + seed audit only | `scripts/` |
| Hosting, CI/CD, monitoring, backups | ❌ Not started | — |
| Known functional gap | ⚠️ Runtime COGS not posted by sales/POS actions | `INTEGRATION-FINDINGS.md` §"Deliberately left" #3 |

**What "complete this version" means:** take the prototype to a **production v1.0**: a real backend
and database, secure multi-tenant login, the India statutory integrations, tests and hosting. Existing
v1 users move over in stages, following the PRD's Release 1–7 order, and the old v1 is retired at the end.

UX, flows, business rules and the API contract are already designed. Most of the remaining work is
**backend, integration, migration, testing and go-live**, so the functional and BA staff can work in
parallel on test cases, decisions, migration mapping and UAT from day one.

---

## 2. Team & roles (fixed — no additional hires)

| Role | Count | Primary responsibilities | Allocation |
|---|---|---|---|
| **Developer (junior–mid)**: *Dev A, "Platform & Finance"* | 1 | Backend scaffold, auth, tenancy/RLS, accounting/posting engine, tax engine, banking, deployment/infra | 100% |
| **Developer (junior–mid)**: *Dev B, "Operations & Integration"* | 1 | Masters, sales, inventory, purchase, POS, FE ↔ API wiring, v1 migration scripts, GSP integration | 100% |
| **Functional consultant**: *F1, "Finance & Tax"* | 1 | Accounting, GST/TDS, banking, payroll, FA, close; golden test scenarios; finance UAT lead; v1 finance data mapping | 100% |
| **Functional consultant**: *F2, "Supply Chain & Ops"* | 1 | Sales, purchase, inventory, POS, projects, manufacturing; golden scenarios; ops UAT lead; v1 ops data mapping | 100% |
| **Business Analyst** | 1 | Product-owner proxy, backlog & acceptance criteria, decision register, v1 user liaison & change management, release notes, user docs | 100% |
| **Intern**: *I1, "QA automation"* | 1 | Playwright E2E, API tests (from OpenAPI examples), regression suite, migration reconciliation checks | ~35–40% effective |
| **Intern**: *I2, "Data & docs"* | 1 | Import templates, v1 extract/cleanup, test data, help articles, training material | ~35–40% effective |

### Covering the gaps without hiring

| Gap | Risk | Mitigation within the team |
|---|---|---|
| No senior engineer / architect | Weak early decisions on RLS, posting atomicity and money precision are expensive to undo | Short architecture decision records (ADRs) for tenancy, money type and posting transaction, written in S1 and reviewed by both devs. Port the proven `engine.ts` rules instead of redesigning them. Invariant and isolation tests in CI from S2. *(Scenario A: every PR also runs Claude Code `/code-review`; auth/RLS/posting PRs also run `/security-review`.)* |
| No dedicated QA | Regressions in accounting are costly | F1/F2 own test cases & UAT; I1 automates them; financial invariants run on every PR |
| No DevOps | Go-live, backups, monitoring | **Managed services only** for v1 (Azure Container Apps + Azure Database for PostgreSQL Flexible + Blob + Key Vault), no Kubernetes until needed; Dev A owns infra-as-code |
| No UX designer | — | Not needed: design system + all screens exist |
| Only 2 devs (key-person risk) | Illness or attrition stalls a whole area | Pair on the posting engine and auth; both devs review each other's PRs; ADRs + `docs/` kept current |

---

## 3. Two timelines: with vs without Claude Code Max

Both timelines use the same team, scope and release order. The only difference is whether each
developer has a **Claude Code Max plan** (2 plans, one per developer).

### 3.1 Capacity model

Effort below is in **base dev-days**: the work a junior–mid developer does without an AI assistant.

| | Scenario A: **with** 2 × Claude Code Max | Scenario B: **without** |
|---|---|---|
| Devs: 2 × 10 days × ~70% focus | 14 days → ×**1.8** output ≈ **25** | 14 |
| Interns: 2 × 10 days × ~35% effective | 7 | 7 |
| **Capacity per sprint (before pilot go-live)** | **~32** | **~21** |
| After go-live (20% reserved for v1-user support) | ~26 | ~17 |

**Where the ×1.8 comes from.** A large share of this backlog is boilerplate that Claude Code
does quickly, and each item still gets human review:

- ~900 contract-defined endpoints, DTOs and validation generated from `docs/api/openapi.yaml`
- porting `src/store/engine.ts` and module `actions.ts` files into NestJS services
- unit and API tests generated from the ~1,900 OpenAPI examples
- FE ↔ API adapter wiring, one module at a time
- v1 → v2 migration scripts and reconciliation queries
- `/code-review` and `/security-review` on every PR, which partly stands in for the missing senior reviewer

The accounting/tax judgement, UAT and v1 user work are not accelerated, so the gain is well under
the raw coding speed-up. Max-plan usage limits may throttle heavy days: batch large generation jobs
and keep a manual fallback.

### 3.2 Effort per phase vs capacity

| Phase | Est. effort (base dev-days) | **A** sprints | A fit | **B** sprints | B fit |
|---|---|---|---|---|---|
| 0/1 Foundation (R1) | ~125 | 4 | ✅ 128 | 6 | ✅ 126 |
| 2 Accounting & Sales MVP (R2) | ~135 | 5 | ✅ 160 (slack for v1 gaps) | 7 | ✅ 147 |
| 2b UAT, v1 migration, go-live | ~60 | 2 (+S12 overlap) | ✅ | 3 (+overlap) | ✅ |
| 3 Inventory & full Sales (R3) | ~90 | 4 | ⚠️ ~91 (incl. hypercare) | 6 | ✅ ~94 |
| 4 Purchase & Banking (R4) | ~105 | 4 | ⚠️ 104 | 6 | ⚠️ 102 |
| 5 GST compliance & POS (R5) | ~90 | 4 | ✅ 104 | 6 | ✅ 102 |
| 6 Enterprise finance & reports (R6) | ~115 | 4 | ⚠️ 104, apply deferrals | 6 | ⚠️ 102, apply deferrals |
| 7a Services profile (R7, part 1) | ~70 | 3 | ✅ 78 | 4 | ⚠️ 68 |
| GA hardening | ~45 | 2 | ✅ | 3 | ✅ |
| **v1.1** Manufacturing (R7, part 2) | ~100–120 | 5 | ✅ | 7 | ✅ |

⚠️ = fits only if the phase's **"can defer"** items (Section 5) are pushed out.
With a fixed team, **Manufacturing is moved to v1.1** in both scenarios.

### 3.3 Milestones side by side

| # | Milestone | **Scenario A** (with Claude Code) | **Scenario B** (without) | Slip |
|---|---|---|---|---|
| M0 | Kick-off, R1–R2 decisions frozen, v1 usage inventory done | Fri 16 Oct 2026 (S1) | Fri 16 Oct 2026 (S1) | — |
| M1 | **Foundation (R1)** on real backend | Fri 27 Nov 2026 (S4) | Fri 25 Dec 2026 (S6) | +4 wk |
| M2 | **Accounting & Sales MVP (R2)** feature-complete | Fri 5 Feb 2027 (S9) | Fri 2 Apr 2027 (S13) | +8 wk |
| M3 | UAT sign-off + v1 migration dress rehearsal passed | Fri 5 Mar 2027 (S11) | Fri 14 May 2027 (S16) | +10 wk |
| M4 | ★ **Pilot go-live: first internal v1 users move to v2** | **Thu 1 Apr 2027** (FY 2027-28 start) | **Tue 1 Jun 2027** (mid-year cut-over) | +2 mo |
| M5 | Inventory & full Sales (R3) live | Fri 30 Apr 2027 (S15) | Fri 6 Aug 2027 (S22) | +14 wk |
| M6 | Purchase & Banking (R4) live | Fri 25 Jun 2027 (S19) | Fri 29 Oct 2027 (S28) | +18 wk |
| M7 | GST compliance + POS (R5) live | Fri 20 Aug 2027 (S23) | Fri 21 Jan 2028 (S34) | +22 wk |
| M8 | Enterprise finance (R6) live | Fri 15 Oct 2027 (S27) | Fri 14 Apr 2028 (S40) | +26 wk |
| M9 | Services profile (R7a) live | Fri 26 Nov 2027 (S30) | Fri 9 Jun 2028 (S44) | +28 wk |
| M10 | ★ **v1.0 GA**: all internal users on v2, **old v1 read-only** | **Fri 24 Dec 2027** (S32) | **Fri 21 Jul 2028** (S47) | **+7 mo** |
| M11 | **v1.1** Manufacturing | Fri 3 Mar 2028 (S37) | Fri 27 Oct 2028 (S54) | +8 mo |

**Summary:** Claude Code Max plans pull v1.0 GA forward by about **7 months** (Dec 2027 vs Jul 2028).
They also let the pilot start on **1 Apr 2027**, a clean financial-year opening, instead of a
mid-year cut-over on 1 Jun 2027.

### 3.4 Gantt: Scenario A (with Claude Code)

```
Sprint     S1-S4      S5------S9    S10-11  S12-S15      S16-S19      S20-S23      S24-S27      S28-30  S31-32   S33-S37
           Oct-Nov'26 Dec-Feb'27    Feb-Mar Mar-Apr'27   May-Jun'27   Jul-Aug'27   Aug-Oct'27   Oct-Nov Dec'27   Jan-Mar'28
R1 Found.  ██████
R2 MVP                ██████████
UAT/Migr                            █████ ★1 Apr pilot
R3 Inv/Sales                              ████████
R4 Pur/Bank                                            ████████
R5 GST/POS                                                          ████████
R6 Ent.fin                                                                       ████████
R7a Serv.                                                                                     ██████
GA                                                                                                    ████ ★GA
v1.1 Mfg                                                                                                       ██████████
```

### 3.5 Gantt: Scenario B (without Claude Code)

```
Sprint     S1----S6   S7-------S13  S14-S16  S17-S22      S23-S28      S29-S34      S35-S40      S41-S44  S45-47  S48-S54
           Oct-Dec'26 Jan-Apr'27    Apr-May  May-Aug'27   Jul-Oct'27   Oct'27-Jan'28 Jan-Apr'28  Apr-Jun  Jun-Jul Jul-Oct'28
R1 Found.  █████████
R2 MVP                ███████████
UAT/Migr                            ██████ ★1 Jun pilot
R3 Inv/Sales                                 ████████████
R4 Pur/Bank                                               ████████████
R5 GST/POS                                                             ████████████
R6 Ent.fin                                                                           ████████████
R7a Serv.                                                                                         ████████
GA                                                                                                         ██████ ★GA
v1.1 Mfg                                                                                                          ██████████████
```

**Recommendation: Scenario A.** Two Max plans cost far less than 7 months of the whole team's time.
They are also the only lever this fixed team has to hit the 1 Apr 2027 financial-year cut-over.

---

## 4. Guiding principles

1. **Release by value, not by module.** Follow the PRD order (Foundation → Accounting & Sales MVP → …).
2. **Internal v1 users are the pilot.** They move in waves, grouped by the v1 features they depend on
   (Section 6). Nobody is moved before v2 covers what they use daily.
3. **Contract-first.** The OpenAPI contract in `docs/api` is the spec. The backend implements it, and the
   front end switches from the in-browser store to the API one module at a time behind a data-access adapter.
4. **Port business rules instead of rewriting them.** `src/store/engine.ts` is already TypeScript. Move it
   into NestJS domain services with exact decimal money (no floats) and database transactions.
5. **Financial invariants are release gates.** Balanced journals, TB nets to zero, AR/AP/inventory control
   equals the sub-ledger, no negative stock, tenant-isolation negative tests, and **v1 vs v2 migration
   reconciliation**. All are automated in CI.
6. **Descope before slipping.** Each phase lists what can be deferred.

---

## 5. Phase-by-phase scope

Sprint numbers are given as **A / B**. API operation counts come from `docs/api/README.md`.

### Phase 0 + 1 — Mobilise & Foundation (R1) · A: S1–S4 · B: S1–S6

**Goal:** a real backend skeleton and secure multi-tenant onboarding.
**Scope (≈ Auth 22 · Admin ~60 · Platform 16 · System 16 · Masters ~70 ops)**

| Workstream | Owner | Work |
|---|---|---|
| Architecture & setup | Dev A | NestJS monorepo (`api`, `worker`), PostgreSQL + ORM, migrations, RLS by `tenant_id`, Redis/BullMQ, decimal/minor-unit money, correlation IDs, error model per `openapi.yaml`, CI (typecheck, lint, test, build), staging on Azure, ADRs |
| Identity | Dev A | Login, JWT/refresh, invitations, password reset, MFA (TOTP), sessions, roles & `<module>.<resource>.<action>` permissions, entitlement |
| Organisation | Dev B | Tenant, company, branch, FY & periods, currencies, tax registrations, number series, audit log, attachments (Azure Blob), notifications |
| Masters | Dev B + I2 | Generic CRUD pattern generated from the OpenAPI contract, covering customers, suppliers, items, UOM, HSN/SAC, tax rates, payment terms, price lists and warehouses; import wizard backend |
| Front-end wiring | Dev B | `src/api/` client + adapter so `useCollection`/`useRecord` read from the API per module (flag: `local` vs `api`) |
| v1 discovery | BA + F1 + F2 + I2 | **v1 usage inventory**: which internal users/companies use which v1 features, data volumes, v1 database access, custom reports they rely on |
| Quality | I1 | API test harness from OpenAPI examples; tenant-isolation negative suite (release-gating, NFR-05) |
| Functional | F1, F2, BA | Close decisions D1–D8; R1/R2 acceptance criteria; golden scenarios E2E-01, E2E-04 |

**Can defer:** SSO/SAML, API keys, platform billing automation, custom fields.

### Phase 2 — Accounting & Sales MVP (R2) · A: S5–S9 · B: S7–S13

**Goal:** a service or simple-goods company can invoice, collect and produce reconciled books.
**Scope (≈ Accounting 40 · Sales ~35 · Reports ~15 · Approvals 5 · Taxation ~8 ops)**

| Workstream | Owner | Work |
|---|---|---|
| Posting engine | Dev A | Port `postJournal / reverseJournal / accountBalance / postingCheck / allocateNumber` into DB transactions with idempotency keys + outbox; period lock (`423`) |
| Accounting | Dev A | COA, dimensions, manual journals (draft → approve → post → reverse), opening balances, GL, day book, TB, customer ledger |
| Tax engine (GST) | Dev A + F1 | Server-side `computeDocument` + `taxContextFor`: CGST/SGST/IGST, place of supply, HSN/SAC, rounding; tax summary |
| Sales MVP | Dev B | Sales invoice (draft/approve/post/cancel/reverse), basic credit notes, receipts + allocation, open items, outstanding; sales register; **runtime COGS journal** (closes INTEGRATION-FINDINGS #3) |
| Documents | Dev B + I2 | Server-side PDF (invoice template), e-mail, attachments |
| Workflow | Dev B | Approval rules for Sales Invoice & Journal; approvals inbox API |
| v1 migration build | Dev B + I2 + F1 | Extract → map → load scripts for companies, COA, parties, items, open invoices/bills, opening balances; reconciliation report (v1 TB = v2 opening TB) |
| Quality | I1 + F1 | Accounting golden scenarios automated; invariants suite (port `audit-seed.mts` checks to run against the DB) |

**Can defer:** multi-currency (INR-only MVP), recurring journals, intercompany, advanced approval designer.

### Phase 2b — UAT, v1 migration rehearsal, pilot go-live · A: S10–S11 (+S12) · B: S14–S16 (+S17)

| Workstream | Owner | Work |
|---|---|---|
| UAT rounds 1 & 2 | F1, F2, BA | Scripted UAT **by the internal v1 users themselves** on migrated copies of their own data |
| Migration dress rehearsals | Dev B, I2, F1 | Two full rehearsals from a v1 snapshot; timed cut-over runbook; sign-off on reconciliation |
| Fixes & performance | Dev A, Dev B | Sev-1/2 fixes; indexes; p95 read < 500 ms, write < 1 s (NFR-02) |
| Operations | Dev A | Production env, backups (RPO ≤ 15 min), restore drill, Sentry + OpenTelemetry, alerts, runbook |
| Security | Dev A (+ `/security-review` in A) | Dependency/vuln scan, OWASP checklist, secrets in Key Vault |
| Enablement | BA + I2 | "What's different from v1" guide, short training videos, support channel & SLA |

**★ Pilot go-live:** A on **Thu 1 Apr 2027**, B on **Tue 1 Jun 2027**. Two weeks of hypercare follow.
- **Scenario A:** balances are loaded as provisional openings at 31 Mar 2027. They are re-loaded once
  v1's FY 2026-27 books are finalised and audited.
- **Scenario B:** the cut-over is mid-year. Opening balances and open items come from v1 as of 31 May
  2027, and FY-to-date GST data for returns is also migrated.

### Phase 3 — Inventory & full Sales (R3) · A: S12–S15 · B: S17–S22

- Warehouses, stock opening (migrated from v1), stock ledger, moving-average valuation, adjustments, transfers, counts, batches/serials.
- Quotation → sales order (credit check, reservations) → delivery (partial) → invoice; returns; AR ageing, statements, collections; CRM leads/activities if capacity allows.
- E2E-09 (trading lifecycle) automated. **Migration wave 2**: v1 users who need stock.

**Can defer:** landed cost, replenishment suggestions, CRM pipeline board.

### Phase 4 — Purchase & Banking (R4) · A: S16–S19 · B: S23–S28

- Requisition → PO → GRN (+QC) → vendor invoice with GRNI, 2/3-way match & duplicate detection → debit notes → payments → AP ageing.
- Bank/cash accounts, vouchers, statement import (CSV/Excel for the banks in D12), reconciliation workbench, payment batches (maker-checker, bank file).
- E2E-02 (purchase-to-pay), E2E-03 (period close) automated. **Migration wave 3**: v1 users who need purchase/banking.

**Can defer:** RFQ/award, 4-way match, bank APIs (file-based first), UTR auto-matching.

### Phase 5 — GST compliance & POS (R5) · A: S20–S23 · B: S29–S34

- **GSP integration** (vendor from D10): e-invoice (IRN/QR), e-way bill, cancellation windows, retries & manual fallback (`502 PROVIDER_UNAVAILABLE`).
- GSTR-1 JSON, GSTR-2B import & ITC reconciliation, GSTR-3B preparation, TDS/TCS.
- POS terminal, shifts, split tender, hold/resume, returns, shift close (online-only for v1 per D13).
- E2E-05 (idempotency/concurrency) automated.

**Can defer:** offline POS, direct GSTN filing (export JSON for the CA to upload).

> If internal v1 users already file e-invoices from v1, **bring the GSP integration forward into
> R2/R3**. They cannot move to v2 without it. D3 settles this in S1.

### Phase 6 — Enterprise finance & reporting (R6) · A: S24–S27 · B: S35–S40

- Payroll: employees, structures, runs, payslips, statutory (PF/ESI/PT/TDS), payroll journal, bank file.
- Fixed assets: register, capitalisation, depreciation (Companies Act + IT Act), disposals.
- Budgets, budget vs actuals, expense claims & reimbursements.
- Full financial reports as async jobs (P&L, BS, cash flow, CFO dashboard), saved reports, exports; multi-currency & FX revaluation; group consolidation (E2E-06, E2E-07).
- Workflow designer, webhooks (29 domain events), integrations page.

**Can defer:** consolidation eliminations/CTA, payroll statutory file formats, forecasting, custom fields.

### Phase 7a — Services profile (R7, part 1) · A: S28–S30 · B: S41–S44

- Nature-aware onboarding (trading / services / hybrid) and profile-driven navigation.
- Contracts (fixed, T&M, milestone, retainer), timesheets, billing runs, revenue recognition, profitability (E2E-10).

**Can defer:** usage-based billing, resource planning board.

### GA hardening · A: S31–S32 · B: S45–S47

Full regression, performance test at the agreed scale profile (D15), security review, DR drill,
final migration of any remaining v1 users, **v1 switched to read-only archive**, sign-offs per PRD §15.1 → **v1.0 GA**.

### v1.1 — Manufacturing (R7, part 2) · A: S33–S37 · B: S48–S54

BOM & routing (versioned), work centres, MRP, production orders (issue, output, scrap), QC, WIP &
costing, subcontracting (E2E-11). This also closes the WIP reconciliation gap in `INTEGRATION-FINDINGS.md`.

---

## 6. v1 → v2 migration & retirement plan

| Step | When (A / B) | Owner | Output |
|---|---|---|---|
| v1 usage inventory (users, companies, modules, reports, integrations, volumes) | S1 / S1 | BA, F1, F2, I2 | Wave plan: which users move with which release |
| Data mapping v1 → v2 (masters, COA, open items, balances, stock, GST history) | S2–S5 / S2–S7 | F1, F2, I2 | Mapping sheet + data-quality issue list |
| Migration scripts + reconciliation report | S5–S9 / S7–S13 | Dev B, I2 | Repeatable, idempotent loaders; v1 vs v2 TB/AR/AP/stock comparison |
| Dress rehearsals ×2 | S10–S11 / S14–S16 | Dev B, F1, F2 | Timed runbook, signed reconciliation |
| **Wave 1**: services / invoicing-only users | 1 Apr 2027 / 1 Jun 2027 | All | Live on v2 |
| **Wave 2**: stock users | after R3 | All | Live on v2 |
| **Wave 3**: purchase/banking/GST-heavy users | after R4/R5 | All | Live on v2 |
| **Wave 4**: payroll/FA/services users; v1 → read-only | GA | All | v1 archived; 8-year retention plan (NFR-11) |

**Rule:** until a user's wave goes live they stay on v1 and keep full support. **No dual entry.**
A company is on v1 or v2, never both, apart from a time-boxed parallel-run check during rehearsals.

---

## 7. How we work

| Cadence | What | Who |
|---|---|---|
| Daily (15 min) | Stand-up, blockers, defect triage | All |
| Sprint start (Mon, 1 h) | Planning: BA brings ready stories with acceptance criteria & golden examples | All |
| Mid-sprint (Wed wk 2) | Functional demo on staging | Devs, F1, F2, BA |
| Sprint end (Fri, 1 h) | Review/demo + retro; release notes | All (+ internal v1 users from UAT onward) |
| Weekly (1 h) | Design review of posting, auth, RLS and migration changes | Dev A, Dev B, F1 |
| Monthly | Steering: milestone status, risks, scope and wave decisions | BA, sponsor |

**Definition of Ready (story):** the API operation(s) are identified in `docs/api` · acceptance
criteria are written · F1/F2 have given at least one worked accounting/tax example · permissions are
listed · decision dependencies are closed · the v1 equivalent behaviour is noted.

**Definition of Done (story):** implemented against the contract · FE wired to API · unit and API
tests · tenant-isolation test for new tables · invariants suite green · migration mapping updated if
data shape changed · functional sign-off on staging · help docs updated.

**Branching & environments:** `main` (protected) → `staging` (auto-deploy, UAT) → `prod` (tagged
releases). Feature branches + PR review by the other developer (*A: plus Claude Code `/code-review`;
`/security-review` on auth/RLS/posting*).

**Claude Code usage rules (Scenario A):** Claude Code generates code and tests, and the developer who
commits it owns it. Accounting and tax logic must pass the golden scenarios written by F1/F2, not
tests generated alongside the code. Never paste production customer data or secrets into prompts.

**Tooling:** Jira/Linear board with epics = PRD epics (EP-01…EP-22), labels = release (R1…R7) and
migration wave; decisions & ADRs in `docs/`; Sentry + OpenTelemetry in production.

---

## 8. Decision register

From FRD §25 and PRD §17. **A decision not closed by its "needed by" sprint blocks that sprint.**
"Needed by" is given as A / B.

| # | Decision | Owner | Needed by |
|---|---|---|---|
| D1 | MVP boundary: service-only vs basic stock items in R2 (driven by D3) | BA + sponsor | S1 / S1 |
| D2 | Hosting (Azure Container Apps), ORM, auth approach (self-built vs Entra/Auth0) | Dev A + Dev B | S1 / S1 |
| D3 | **v1 usage inventory & migration waves.** Which internal users use which features, and whether any need e-invoice/stock/purchase on day one | BA + F1 + F2 | S1 / S1 |
| D4 | GSTIN/PAN validation service for onboarding | F1 | S2 / S2 |
| D5 | FY start vs books-beginning semantics; opening balances from v1 | F1 | S2 / S3 |
| D6 | Branch-wise GST registration & numbering (continue v1 number series or restart?) | F1 | S3 / S4 |
| D7 | Edition matrix, limits, pricing (internal users' plan) | BA + sponsor | S3 / S5 |
| D8 | Approval rules in R2 (material change, recall, self-approval) | F1 + BA | S4 / S6 |
| D9 | v1 data access (DB snapshot vs export), history depth to migrate (open items only vs full FY) | F1 + Dev B | S3 / S4 |
| D10 | **GST provider (GSP/ASP)** for e-invoice & e-way bill + fallback UX | F1 + Dev B | S12 / S20 (earlier if D3 says so) |
| D11 | Valuation method(s), batch/serial scope, negative stock policy | F2 | S11 / S16 |
| D12 | Bank statement formats & banks for payment files | F1 | S14 / S21 |
| D13 | POS: online-only vs offline for v1 | F2 + BA | S16 / S25 |
| D14 | Multi-currency: currencies, rate provider, revaluation policy | F1 | S20 / S31 |
| D15 | Quantitative scale profile for performance tests | BA + Dev A | S20 / S31 |
| D16 | Payroll statutory scope & confidentiality model | F1 | S21 / S33 |
| D17 | Consolidation standard, eliminations, CTA | F1 | S23 / S35 |
| D18 | Manufacturing depth for v1.1 (discrete/process, MRP, subcontracting) | F2 + sponsor | S28 / S42 |
| D19 | v1 retirement: read-only period, retention (8 yrs), archival & deletion policy | BA + legal | S28 / S42 |

---

## 9. Top risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Junior–mid devs get core accounting/RLS design wrong (no senior on team) | Med | High | ADRs in S1, pairing on posting/auth, port proven `engine.ts` rules, invariant + isolation tests in CI from S2; *A: `/code-review` + `/security-review` on every PR* |
| **Internal v1 users depend on features that arrive in a later release** | High | High | D3 in S1; migrate in waves; re-order R3–R5 items (e.g. GSP) ahead if a wave needs them |
| Migration data quality in v1 (duplicates, unbalanced history) | High | Med | Early mapping & cleanup by I2/F1; two dress rehearsals; reconciliation report as a go-live gate |
| Pilot date slips (A: 1 Apr 2027) | Med | High | Freeze R2 scope at M2; multi-currency & advanced workflow already deferred; UAT sprints protected. Fallback is a 1 May cut-over. |
| Scenario B: 7-month longer run means v1 support for longer | High | Med | Budget v1 maintenance time; freeze v1 features now (critical fixes only) |
| Claude Code Max usage limits throttle peak weeks (A) | Med | Low | Batch generation work; stagger heavy sessions between the two devs; manual fallback |
| GSP onboarding/sandbox delays | High | Med | Sign GSP by D10; build against sandbox early; manual JSON export fallback |
| Decisions arrive late | High | Med | Decision register with "needed by" sprint; BA escalates at monthly steering |
| Production support eats feature capacity after go-live | High | Med | 20% support buffer from pilot onward; rotate one dev on support per sprint |
| Floating-point money errors | Low | High | Decimal/minor-unit types enforced; lint rule; golden tests with paise rounding |
| Key-person dependency (only 2 devs) | Med | High | Pairing, cross-review of all PRs, ADRs & docs current |

---

## 10. Immediate next steps (Sprint 1: 5–16 Oct 2026)

1. **Sponsor decision:** Scenario A (buy 2 × Claude Code Max) or B. This plan recommends A.
2. BA + F1 + F2: **v1 usage inventory** (D3) → wave plan → confirm MVP boundary (D1).
3. Dev A: scaffold NestJS + PostgreSQL + CI + staging; ADRs for tenancy/RLS, money type, posting transaction.
4. Dev B: build the `src/api/` adapter and wire **one** module end-to-end (Masters › Customers) as the pattern; get v1 database/export access (D9).
5. F1/F2: golden scenarios for E2E-01 (sales-to-cash) and E2E-04 (tenant isolation) with exact expected journals.
6. BA: set up the board (epics EP-01…EP-22, releases R1…R7, migration waves); groom R1 backlog for S2; announce the plan and v1 feature freeze to internal users.
7. I1: API test harness from OpenAPI examples. I2: v1 data extract + import templates for customers/items/COA.
