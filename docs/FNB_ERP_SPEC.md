# F&B ERP Spec: Extension of Existing App (Indonesia)

Scope: extend the existing application with an F&B ERP core, with **Menu Engineering and Costing** as a first-class module.
Audience: Cursor (AI coding agent) and the developer supervising it.
How to read: requirement IDs (e.g. `COST-03`) are referenced in prompts, commits, and tests. "MUST" is mandatory, "SHOULD" is preferred, "MAY" is optional.

---

## 1. Goals and Non-Goals

**Goals**
- Control stock, purchasing, and recipe cost accurately for restaurants, cafes, and hotel F&B in Indonesia.
- Know the true cost and margin of every menu item, per channel (dine-in, takeaway, GoFood, GrabFood, ShopeeFood).
- Turn sales and cost data into menu engineering decisions (price, reposition, rework, remove).
- Auto-post to accounting, reconcile payments and delivery payouts, and close periods cleanly.

**Non-goals (for now)**
- Replacing the existing app's UI framework or architecture.
- Full HR and payroll (only service charge pool and basic hooks).
- Building a tax filing system (produce clean reports and exports only).

---

## 2. Architecture Principle

```
MASTER DATA → TRANSACTION DOCUMENTS → STOCK LEDGER + GL POSTING → RECONCILIATION → REPORTS
                    ↑                                                      |
                    └────────── approvals, audit trail, permissions ───────┘
```

Build the **stock ledger** and **posting engine** first. Everything else creates documents that call them.

---

## 3. Existing-App Integration Plan

The app already exists. Phase 0 is discovery and must produce `docs/ERP_GAP_ANALYSIS.md` containing:

| Section | Content |
|---|---|
| Stack summary | Language, framework, DB, ORM, auth, UI kit, test setup, job runner, deployment |
| Existing entities | Items/products, categories, suppliers, outlets, users/roles, orders, payments, accounts (whatever exists) |
| Mapping table | Each spec entity → `exists as X` / `extend X with fields` / `create new` |
| Conflicts | Places where existing behavior contradicts this spec |
| Risks | Data migration, breaking changes, performance, offline needs |
| Proposed migration plan | Ordered, additive, reversible |

No code changes in Phase 0. The developer reviews and approves the gap analysis before Phase 1.

---

## 4. Domain Model (logical)

Names are logical. Map to existing tables where they exist.

**Master data**
- `outlet`, `location` (warehouse, chiller, freezer, dry store, bar), `cost_center`
- `item` (type: raw, semi_finished, finished, packaging, non_stock), `item_uom_conversion`, `item_category`
- `supplier`, `supplier_item_price`
- `tax_rate` (type: PB1, PPN, SERVICE, PPH21, PPH23, PPH4_2; rate; base rule; effective_from/to; region/outlet)
- `payment_method` (clearing account, fee rule)
- `account` (chart of accounts), `posting_rule`
- `user`, `role`, `permission`

**Inventory and purchasing**
- `stock_ledger` (append-only), `stock_balance` (derived or materialized)
- `purchase_request`, `purchase_order`, `goods_receipt`, `purchase_invoice`, `purchase_return`, `direct_purchase`, `supplier_payment`
- `stock_transfer`, `stock_count`, `stock_adjustment`, `waste_log`
- `batch_lot` (expiry, halal doc ref)

**Recipe, costing, menu**
- `recipe`, `recipe_version`, `recipe_line`
- `item_cost` (effective-dated), `menu_cost_snapshot`
- `menu_item`, `menu_modifier`, `modifier_line`, `menu_combo`, `menu_price` (effective-dated, per price level)
- `channel_config` (commission %, promo subsidy rule, packaging rule)
- `cost_target`, `price_proposal`
- `me_run`, `me_result`, `me_action`
- `variance_run`

**Sales and settlement**
- `sales_order`, `sales_order_line`, `sales_payment`, `shift`, `daily_close`
- `settlement_batch`, `platform_payout`, `reconciliation_match`

**Accounting**
- `journal`, `journal_line`, `fiscal_period`, `ap_open_item`, `ar_open_item`

**Cross-cutting**
- `approval_workflow`, `approval_request`, `audit_log`, `attachment`, `notification`

---

## 5. Module Requirements

### 5.1 Foundation (FND)

| ID | Requirement |
|---|---|
| FND-01 | MUST support multiple outlets; outlet is a dimension on all transactional records |
| FND-02 | MUST support role-based permissions per action and per outlet |
| FND-03 | MUST provide an immutable audit log for create, update, approve, void, price change, and period actions |
| FND-04 | MUST provide a configurable approval workflow (document type, value threshold, approver role) |
| FND-05 | MUST store UoM in base units with an explicit per-item conversion table |
| FND-06 | MUST support effective-dated tax rates and service charge rates |
| FND-07 | MUST provide a shared money/rounding helper used by every calculation |
| FND-08 | MUST provide attachments (receipts, delivery notes, photos) on documents |
| FND-09 | SHOULD provide notifications (low stock, expiry, pending approvals, cost alerts, cash variance) |
| FND-10 | MUST provide data import for items, suppliers, recipes, opening stock, and opening balances, with a dry-run validation mode |

### 5.2 Inventory (INV)

| ID | Requirement |
|---|---|
| INV-01 | MUST implement an append-only stock ledger; balances derive from it |
| INV-02 | MUST compute weighted average cost on every receipt; store resulting unit cost on each ledger row |
| INV-03 | MUST support locations per outlet and transfers (two-step: send, in-transit, receive) |
| INV-04 | MUST support stock count with approval before variance posts |
| INV-05 | MUST support waste/spoilage/staff meal/sampling/comp with mandatory reason codes |
| INV-06 | MUST support batch and expiry tracking where item flagged; FEFO suggestion on issue |
| INV-07 | MUST prevent negative stock by default, configurable per item category (some outlets allow it for backflush) |
| INV-08 | SHOULD support par level, min/max, and reorder point per item per outlet |
| INV-09 | MUST support item costing method per category: weighted average (default), last purchase, standard |

### 5.3 Purchasing (PUR)

| ID | Requirement |
|---|---|
| PUR-01 | MUST implement PR → approval → PO → GRN → invoice → 3-way match → payment |
| PUR-02 | GRN MUST record quantity, price, expiry, batch, temperature (optional), halal marking, and QC accept/partial/reject with reason |
| PUR-03 | MUST support partial deliveries and backorders |
| PUR-04 | 3-way match MUST have configurable quantity and price tolerance |
| PUR-05 | MUST support `direct_purchase` for informal/wet-market buying: attachment required, goes to inventory or COGS per item |
| PUR-06 | MUST support purchase returns that reverse stock and cost correctly |
| PUR-07 | MUST support withholding tax (PPh) on supplier payments, with bukti potong data |
| PUR-08 | SHOULD suggest PRs from par level and forecast |

### 5.4 Recipe and Costing (COST) (core module)

| ID | Requirement |
|---|---|
| COST-01 | MUST support recipes with lines in any UoM, converted to base units |
| COST-02 | MUST support yield % and trim/waste % per item and per recipe line; compute edible portion (EP) cost |
| COST-03 | MUST support nested sub-recipes (sauce, stock, marinade, dough) to unlimited depth with loop detection |
| COST-04 | MUST version recipes with effective dates; edits create new versions; history preserved |
| COST-05 | MUST compute plate cost = Σ line cost ÷ portions + packaging + consumables allowance |
| COST-06 | MUST support modifiers and variants (add/remove/replace ingredient, size) with qty deltas and price deltas |
| COST-07 | MUST support combo/package costing with revenue allocated to components by standalone-price ratio (configurable) |
| COST-08 | MUST support packaging cost per channel (dine-in, takeaway, delivery) |
| COST-09 | MUST support cost basis selection per item category (weighted average, last purchase, standard) |
| COST-10 | MUST store a cost snapshot (recipe version, ingredient costs used, date) on each roll-up |
| COST-11 | MUST flag recipes with missing ingredient cost as `incomplete`; never treat missing as zero |
| COST-12 | MUST recompute incrementally via a dependency graph (item → recipe → menu item) when item cost changes; also provide a nightly full roll-up |
| COST-13 | MUST raise alerts: food cost % above target, ingredient price change over X% in N days, margin below minimum Rp, stale cost, priced below cost on a channel |
| COST-14 | MUST provide a simulate mode (draft costs/prices, nothing saved) |
| COST-15 | MUST provide printable recipe cost sheet (ingredients, EP cost, yield, plate cost, food cost %) |
| COST-16 | SHOULD support optional labor-time and overhead allocation for fully loaded cost |

### 5.5 Pricing (PRC)

| ID | Requirement |
|---|---|
| PRC-01 | MUST support price levels: dine-in, takeaway, GoFood, GrabFood, ShopeeFood, banquet, member |
| PRC-02 | MUST build price: net → + service charge → + PB1 on (net + service) = gross; and reverse (gross → net). Order and base are configurable |
| PRC-03 | MUST support target-based suggestion: `suggested net = plate cost ÷ target food cost %` |
| PRC-04 | MUST support price rounding rules (nearest Rp 500/1,000, end in 9/000), applied to gross |
| PRC-05 | MUST show delivery net margin: price − platform commission − promo subsidy − packaging − plate cost |
| PRC-06 | MUST support effective-dated (scheduled) price changes |
| PRC-07 | MUST implement price proposal workflow: draft → simulate → approve → schedule → publish to POS/platform feeds |
| PRC-08 | MUST keep full price history with user and reason |
| PRC-09 | SHOULD track post-change impact (2-4 weeks before vs after: volume, margin) |
| PRC-10 | SHOULD block or warn on POS discounts that push an item below its minimum margin |

### 5.6 Menu Engineering (ME)

| ID | Requirement |
|---|---|
| ME-01 | MUST run per period, outlet, category, and channel (and optional daypart) |
| ME-02 | MUST implement Kasavana-Smith classification: Star, Plowhorse, Puzzle, Dog |
| ME-03 | Popularity threshold default = (1 ÷ number of items in category) × 70%; configurable |
| ME-04 | Margin threshold default = weighted average contribution margin of the category; configurable |
| ME-05 | MUST analyze within a category only |
| ME-06 | MUST use actual net price paid (after discounts) and the cost snapshot valid at time of sale |
| ME-07 | MUST exclude voids, comps, and test orders |
| ME-08 | MUST flag `insufficient data` below a configurable minimum (units or operating days) and `new` for items under N weeks |
| ME-09 | MUST adjust for availability: days an item was 86'd (out of stock) are excluded or flagged |
| ME-10 | MUST allocate modifier and combo revenue/cost to the base item correctly |
| ME-11 | MUST persist results as snapshots (`me_run`, `me_result`); later changes never rewrite past runs |
| ME-12 | MUST show additional metrics: total contribution (Rp), food cost %, revenue share vs profit share, velocity, waste per item, attach/pairing rate |
| ME-13 | MUST provide matrix view (popularity vs CM scatter, quadrant colors), sortable item table, trend view across periods, and before/after view |
| ME-14 | MUST provide action board: suggested action per item (reprice, rework, promote, remove), owner, due date, status; one click creates a `price_proposal` or a new recipe version draft |
| ME-15 | SHOULD compare against same period last year and flag Ramadan/Lebaran periods |

### 5.7 Variance: Theoretical vs Actual (VAR)

| ID | Requirement |
|---|---|
| VAR-01 | MUST compute theoretical usage = Σ(units sold × recipe qty at sale-time version) per ingredient |
| VAR-02 | MUST compute actual usage = opening + purchases − closing (and transfers, waste) per ingredient |
| VAR-03 | MUST show variance in qty and Rp, by ingredient, category, outlet, weekly/monthly |
| VAR-04 | MUST support reason codes (over-portioning, unrecorded waste, theft, receiving error, outdated recipe, wrong yield, UoM/count error) |
| VAR-05 | SHOULD flag persistent variance and suggest recipe/yield correction |

### 5.8 POS Integration (POS)

The existing app may already have a POS or orders. Extend, don't replace.

| ID | Requirement |
|---|---|
| POS-01 | Orders MUST store channel, price level, outlet, terminal, table/covers, daypart, and external ID |
| POS-02 | Modifiers MUST be stored as structured lines (not free text) so they affect stock and cost |
| POS-03 | On bill closed and paid: MUST deduct stock by recipe (backflush) at the recipe version valid at that time. Deduction point is configurable (at sale, at kitchen fire); default at sale |
| POS-04 | Voids after firing MUST log as waste with reason and manager approval |
| POS-05 | Tax and service charge MUST use the configured order and base; tax-inclusive and exclusive both supported |
| POS-06 | Bill numbers MUST be sequential per outlet with terminal ranges; gaps are detectable |
| POS-07 | MUST support split, merge, and table transfer without breaking stock or tax |
| POS-08 | SHOULD support offline mode with idempotent sync and unique transaction IDs |
| POS-09 | SHOULD support KDS/station routing by menu item station |
| POS-10 | MUST support 86 (out-of-stock) flag, and record availability history for ME-09 |

### 5.9 Payment, Shift, Settlement (PAY)

| ID | Requirement |
|---|---|
| PAY-01 | MUST support cash, QRIS, EDC (by bank), e-wallet, transfer, voucher, deposit, platform, city ledger |
| PAY-02 | MUST record tips separately (card and cash) |
| PAY-03 | Shift close MUST record counted cash vs expected, with over/short posting |
| PAY-04 | MUST reconcile POS non-cash sales to bank/acquirer settlements, handling MDR fees |
| PAY-05 | MUST reconcile delivery platform orders to payout statements at order level (commission, promo subsidy, cancellations, adjustments) |
| PAY-06 | MUST reconcile cash deposits to POS cash |
| PAY-07 | Reconciliation MUST support manual matching, auto-matching rules, and an unmatched queue |

### 5.10 Accounting (ACC)

| ID | Requirement |
|---|---|
| ACC-01 | MUST implement a posting engine driven by `posting_rule` (event + category + outlet → debit/credit accounts) |
| ACC-02 | MUST post: GRN, invoice, payment, POS sale, COGS on recipe consumption, waste, count variance, settlement, platform payout, banquet deposit and application, service charge payout |
| ACC-03 | Every journal MUST balance and be created atomically with its source document |
| ACC-04 | MUST provide fiscal periods with lock; changes after lock require reopen with approval and log |
| ACC-05 | MUST provide GR/IR clearing and a month-end report of unmatched receipts |
| ACC-06 | MUST provide AP/AR open items with aging |
| ACC-07 | MUST provide P&L by outlet, balance sheet, and cash flow, or export journals to an external accounting system (see Gap Analysis decision) |
| ACC-08 | MUST provide tax reports: PB1/PBJT, PPN, PPh, service charge, with export |

### 5.11 Banquet and Catering (BNQ) (later phase)

| ID | Requirement |
|---|---|
| BNQ-01 | Quotation → confirmation + DP → BEO → final headcount → event → invoice → payment |
| BNQ-02 | DP posts to customer deposit liability; released to revenue at event |
| BNQ-03 | BEO generates purchase and production requirements from recipes |
| BNQ-04 | Corporate AR with credit terms and aging |

### 5.12 Service Charge and Staff (SVC) (later phase)

| ID | Requirement |
|---|---|
| SVC-01 | Accumulate service charge per period as a liability, separate from revenue |
| SVC-02 | Distribution rules (by position points, attendance), approval, payout, and journal |
| SVC-03 | Export attendance/payroll data hooks (full payroll out of scope) |

---

## 6. Posting Rules (reference)

| Event | Debit | Credit |
|---|---|---|
| GRN posted | Inventory (by category) | GR/IR |
| Purchase invoice posted | GR/IR, Input PPN | Accounts payable |
| Supplier payment | Accounts payable | Bank/Cash, PPh payable |
| Direct purchase | Inventory or COGS | Petty cash/Bank |
| POS sale, cash | Cash on hand | Revenue (food/bev/other), PB1 payable, Service charge payable |
| POS sale, QRIS/EDC/e-wallet | Payment clearing (by method) | same as above |
| Recipe consumption at sale | COGS | Inventory |
| Waste | Waste expense | Inventory |
| Staff meal / sampling / comp | Staff meal or marketing expense | Inventory |
| Count variance | Inventory variance expense (or reverse) | Inventory |
| Shift over/short | Cash over/short | Cash on hand (or reverse) |
| Cash banked | Bank | Cash on hand |
| Acquirer settlement | Bank, MDR expense | Payment clearing |
| Platform payout | Bank, Commission and promo expense | Platform receivable |
| Banquet DP | Bank | Customer deposit |
| DP applied at event | Customer deposit | Revenue |
| Service charge payout | Service charge payable | Bank/Cash |

---

## 7. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | Posting a POS bill (stock + journal) MUST complete in under 500 ms at p95 at expected outlet load |
| NFR-02 | Cost roll-up of 1,000 menu items MUST finish in under 60 seconds; incremental recalculation under 5 seconds for a single ingredient change |
| NFR-03 | ME run for 12 months of data for one outlet SHOULD finish in under 30 seconds |
| NFR-04 | All long jobs MUST be resumable and idempotent |
| NFR-05 | Daily backups, encrypted at rest; PII access logged (UU PDP) |
| NFR-06 | Rates, thresholds, and account mappings MUST be configuration, not code |
| NFR-07 | UI MUST be usable on tablet and phone for receiving, stock count, and approvals |
| NFR-08 | Existing app features and tests MUST keep passing after every phase |

---

## 8. Phases and Acceptance

| Phase | Scope | Acceptance |
|---|---|---|
| **0 Discovery** | Gap analysis, mapping, migration plan | `ERP_GAP_ANALYSIS.md` approved by developer |
| **1 Foundation + Ledger** | FND, INV-01..03, posting engine skeleton, audit log, UoM, tax rates | Ledger append-only; posting rule engine produces balanced test journal; UoM tests pass |
| **2 Purchasing + Inventory** | PUR, INV remaining | Full PR→payment flow; weighted average matches fixture 9.1; GRN/invoice journals correct |
| **3 Recipe + Costing** | COST-01..15 | Fixture 9.2 and 9.3 pass; incremental recalculation works; alerts fire |
| **4 Pricing** | PRC | Fixture 9.3 passes; price proposal workflow end to end |
| **5 POS link + Variance** | POS-01..06, 10; VAR | Sale deducts stock by recipe version; variance report on seeded data |
| **6 Menu Engineering** | ME | Fixture 9.4 classification exact; snapshots immutable; action creates price proposal |
| **7 Payment + Reconciliation + Accounting** | PAY, ACC | Settlement and platform reconciliation on seeded statements; period lock works |
| **8 Banquet, Service Charge, Offline POS, KDS** | BNQ, SVC, POS-08/09 | Per requirement |
| **9 Analytics and forecasting** | Dashboards, anomaly flags, demand forecast | Per requirement |

Phases 0-6 deliver the Menu Engineering and Costing value. Do not start a phase until the previous phase's acceptance criteria pass.

---

## 9. Worked Examples (MUST be test fixtures)

### 9.1 Weighted average cost
Stock 10 kg at Rp 30,000/kg. Receive 5 kg at Rp 36,000/kg.
New average = (10 × 30,000 + 5 × 36,000) ÷ 15 = **Rp 32,000/kg**.
Issue 4 kg: ledger row cost = 32,000; stock value after = 11 × 32,000 = 352,000.

### 9.2 Yield and recipe cost
Whole chicken bought at Rp 40,000/kg, usable yield 70%.
EP cost = 40,000 ÷ 0.70 = **Rp 57,142.857/kg** = 57.142857/g.
Recipe uses 150 g EP chicken: line cost = **Rp 8,571.43**.
Other lines on the dish: rice 8,000; sambal sub-recipe portion 2,500; oil and seasoning 1,500; packaging dine-in 0.
Plate cost = 8,571.43 + 8,000 + 2,500 + 1,500 = **Rp 20,571.43**.

### 9.3 Price build-up
Net price 50,000. Service charge 5% = 2,500. Subtotal 52,500. PB1 10% on subtotal = 5,250. Gross = **57,750**.
Reverse: gross 57,750 → net 50,000 (must round-trip exactly).
Food cost % on net with plate cost 20,571.43 = **41.14%**. Contribution margin = 29,428.57.
Target 33% suggestion: net = 20,571.43 ÷ 0.33 = 62,337.67. After adding SC and PB1, gross = 62,337.67 × 1.05 × 1.10 = 72,000.00 (round to nearest Rp 500/1,000 per rule).
Delivery check: platform price gross 57,750 → net 50,000; commission 20% of (platform's commissionable base per config), packaging 2,000, promo subsidy 0. Net margin must reflect all deductions and be lower than dine-in CM.

### 9.4 Menu engineering classification
Category "Main" has 4 items, period units total 1,000.

| Item | Units | Mix % | Net price | Plate cost | CM (Rp) |
|---|---|---|---|---|---|
| A | 450 | 45% | 60,000 | 30,000 | 30,000 |
| B | 300 | 30% | 40,000 | 25,000 | 15,000 |
| C | 150 | 15% | 55,000 | 20,000 | 35,000 |
| D | 100 | 10% | 25,000 | 15,000 | 10,000 |

Popularity threshold = (1 ÷ 4) × 70% = **17.5%**.
Weighted average CM = (450×30,000 + 300×15,000 + 150×35,000 + 100×10,000) ÷ 1,000 = **Rp 24,250**.
Expected classes: A = **Star** (45% ≥ 17.5, CM 30,000 ≥ 24,250); B = **Plowhorse** (30% high, CM 15,000 low); C = **Puzzle** (15% low, CM 35,000 high); D = **Dog** (10% low, CM 10,000 low).
Edge cases to test: item with units below minimum → `insufficient data`; item launched 2 weeks ago → `new`; item 86'd 10 of 30 days → flagged/adjusted; voids and comps excluded; discount lowers net price used.

### 9.5 Theoretical vs actual variance
Ingredient: chicken (EP). Opening 20 kg, purchases 60 kg (AP), closing 15 kg. Dishes sold use 140 g EP each × 400 dishes = 56 kg EP theoretical.
Convert purchases at 70% yield for comparison basis (config-driven); the report must state the basis used. Variance shown in kg and Rp using weighted average cost.

### 9.6 Journal balance sample
POS cash sale gross 57,750 (net 50,000, SC 2,500, PB1 5,250), recipe COGS 20,571.43:
Dr Cash 57,750 / Cr Revenue 50,000 / Cr Service charge payable 2,500 / Cr PB1 payable 5,250.
Dr COGS 20,571 / Cr Inventory 20,571 (rounded per rounding helper).
Both journals balance.

---

## 10. Open Decisions (resolve in Phase 0 and record)

1. Does the app own the general ledger, or export journals to an external accounting system?
2. Costing method default per category.
3. Stock deduction point (at sale vs at kitchen fire).
4. Single legal entity or multi-entity now.
5. Offline POS needed in phase 1 or later.
6. Which regions' PB1 rules and online tax reporting must be supported first.
7. Which delivery platform integrations are API-based vs file import.
8. Hotel PMS integration needed (room charge, city ledger) or not.
