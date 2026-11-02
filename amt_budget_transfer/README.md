# Budget Transfer Journal (BTJ) – SuiteCloud / SDF Project

## 📌 Project Overview
The **Budget Transfer Journal (BTJ)** is a NetSuite customization built using **SuiteScript 2.1** and the **SuiteCloud Development Framework (SDF)**. It enables governed, audited, zero-sum budget transfers across departments and GL accounts within NetSuite, updating custom budget transactions (`customtransaction_bm_budget_transaction`) while keeping original budget baselines immutable.

- **Account:** NetSuite Sandbox `8236506_SB2` (MTN Group Fintech)
- **Role:** Administrator / Custom Finance Roles
- **Project Structure:** Standard SDF Project (`src/FileCabinet`, `src/Objects`, `manifest.xml`, `deploy.xml`)

---

## 🏗️ Architecture & Components

### 1. Custom Records & Lists (`src/Objects/`)
- `customlist_amt_btj_status.xml`: Custom List with status values:
  - `Draft` (`val_amt_btj_draft`)
  - `Pending Approval` (`val_amt_btj_pending`)
  - `Approved` (`val_amt_btj_approved`)
  - `Posted` (`val_amt_btj_posted`)
  - `Rejected` (`val_amt_btj_rejected`)
  - `Error` (`val_amt_btj_error`)
  - `Reversed` (`val_amt_btj_reversed`)
- `customrecord_amt_btj_setup.xml`: Approval Setup record per subsidiary (defines Senior Manager, Backup approver, GM threshold, and flags).
- `customrecord_amt_btj.xml`: Budget Transfer Header record (Subsidiary, Year, Date, Justification, Memo attachment, Totals, Status, Next Approver, Rejection Reason).
- `customrecord_amt_btj_line.xml`: Budget Transfer Line record child sublist (`custrecord_amt_btjl_parent` pointing to `tab_amt_btj_lines`). Lines store Department, Account, Increase, Decrease, Original Budget, Current Budget, Funds Available, and Budget Reference.

### 2. SuiteScripts (`src/FileCabinet/SuiteScripts/Budget_Transfer_Journal/`)
- `amt_btj_config.json`: Master JSON configuration file with field IDs and record types.
- `amt_btj_lib.js`: Shared library for validation rules (R01–R09), totals calculation, and config loader. Designed to be safe for both client and server contexts.
- `amt_btj_budget.js`: Budget search, lookup, and funds available calculation engine targeting `customtransaction_bm_budget_transaction`.
- `amt_btj_cs.js`: **Client Script** attached to `customrecord_amt_btj`. Handles real-time recalculation of totals, active budget lookup when Dept/Account change, line validation (`validateLine`), and `saveRecord` validation.
- `amt_btj_ue.js`: **User Event Script** (BeforeLoad / BeforeSubmit). Controls UI action buttons, defaults fields (Requestor, Date, Subsidiary), and enforces server-side validation.
- `amt_btj_wfa.js`: **Workflow Action Script**. Executed by NetSuite SuiteFlow:
  - `custscript_amt_btj_wfa_action = 'route'`: Looks up approval rules from Setup and sets `custrecord_amt_btj_next_approver`.
  - `custscript_amt_btj_wfa_action = 'post'`: Triggers the Map/Reduce script (`amt_btj_post_mr`).
- `amt_btj_post_mr.js`: **Map/Reduce Script**. Asynchronously posts budget adjustments to the Custom Budget transaction, locks records, updates lines, and sets status to `Posted`.
- `amt_btj_bud_ue.js`: Guard user event script on the Custom Budget transaction to protect historical baselines.

---

## ⚠️ Current Status & Known Fix (Critical Context)

### The Issue Encountered
When creating a **New Budget Transfer** record from the NetSuite UI (`customrecord_amt_btj`), the user clicks **Save** and gets blocked by a popup:
> *"Rule R01 Violation: Total Increases (0) must equal Total Decreases (0). Transfer must balance to zero."*

### Why this happens:
1. **NetSuite Child Record Architecture:** In NetSuite, a child record sublist (`isparent = T` on `customrecord_amt_btj_line`) **does not render on a brand-new (unsaved) parent record**. The parent header must be saved first to generate an internal ID before lines can be attached!
2. **The Client Script Bug:** `amt_btj_cs.js` was previously validating R01 balance even when `lineCount === 0` or `lineCount === -1` (sublist not rendered).
3. **The Fix Applied Locally:**
   - In `amt_btj_cs.js`:
     ```javascript
     const lineCount = currRec.getLineCount({ sublistId: config.lineSublist });
     // Allow saving an empty Draft (no lines yet or sublist not rendered on create)
     if (lineCount <= 0) return true;
     ```
   - In `amt_btj_ue.js`:
     ```javascript
     if (lines.length > 0) {
         const validation = lib.validateTransfer(header, lines, false);
         ...
     }
     ```

### Why the error still appeared in the browser:
1. **Deployment Needed:** The changes in `amt_btj_cs.js` and `amt_btj_ue.js` are in the local workspace, but **must be deployed to the NetSuite File Cabinet** via SDF (`suitecloud project:deploy`).
2. **Browser Caching:** NetSuite aggressively caches Client Scripts in the browser! Even after deploying, the user must perform a **hard refresh (Ctrl + Shift + R or Ctrl + F5)** or open in an incognito window to load the new JS file.

---

## 🚀 How to Deploy via SuiteCloud CLI

> [!IMPORTANT]
> Always execute SDF commands in **Git Bash** on this system, because Windows PowerShell execution policy blocks `.ps1` npm scripts.

```bash
# 1. Navigate to the project root
cd "C:/Users/IfechukwudeiNwoko/Downloads/Budget Control Transfer/amt_budget_transfer"

# 2. Validate SDF objects
suitecloud project:validate

# 3. Deploy to Sandbox (8236506_SB2)
suitecloud project:deploy
```

---

## 🧪 Testing Guide

Refer to [`BTJ_Test_Plan.md`](./BTJ_Test_Plan.md) for the complete test protocol (Scenarios T01–T09):
- **T01:** Happy Flow Entry & Zero-Sum Balance (Save header as Draft, click Edit, add lines, save balanced transfer).
- **T02:** Unbalanced Validation (R01).
- **T03:** Exceed Funds Available (R02).
- **T04:** Missing Budget Record (R05).
- **T05:** Missing Supporting Memo on Submit (R08).
- **T06:** Approval Routing & Segregation of Duties.
- **T07:** Post Execution & Budget Verification.
- **T08:** Rejection Flow.
- **T09:** Backup Approver Routing.

---

## 📦 SuiteApp Conversion Roadmap (Future Work)
If transitioning this SDF project into a standalone SuiteApp:
1. Create SuiteApp manifest with `<type>SUITEAPP</type>`, `<publisherid>`, `<projectid>`, and `<projectversion>`.
2. Move objects into `SuiteApps/com.amt.budgettransfer/` directory.
3. Validate and package with `suitecloud project:package`.
