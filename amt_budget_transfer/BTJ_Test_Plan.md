# Budget Transfer Journal – Detailed Test Plan
**Environment:** NetSuite Sandbox `8236506_SB2`  
**Record:** `customrecord_amt_btj` (Budget Transfer Journal)  
**Tester Role:** Administrator (unless stated otherwise)

> [!IMPORTANT]
> Run tests **in order** T01 → T09. T07 depends on a record created in T06. Set up the Approval Setup record before starting.

---

## 🔧 Pre-Test Setup (Do Once)

| Step | Action | Where |
|------|--------|-------|
| 1 | Open **Budget Transfer Approval Setup** → New | `Customization > Lists, Records & Fields > Record Types > Budget Transfer Approval Setup` |
| 2 | Set **Subsidiary** = your test subsidiary | — |
| 3 | Set **Senior Manager Approver** = a real sandbox user (e.g. Finance Manager) | — |
| 4 | Set **Backup Approver** = a different sandbox user | — |
| 5 | Leave **Use Backup** = unchecked for now | — |
| 6 | Set **GM Approval On** = unchecked for now | — |
| 7 | Save the Setup record | — |
| 8 | Confirm at least **2 active Custom Budget lines** exist for different Dept/Account combos in the selected Year | `Transactions > Financial > Budget` or your Custom Budget transaction |

---

## T01 – Happy Flow Entry & Zero-Sum Balance

**Purpose:** Confirm basic entry, client-side auto-lookup, and balancing logic all work end-to-end.

### Pre-conditions
- At least two active budget lines exist:
  - **Dept A / Acct X** with Funds Available ≥ 50,000
  - **Dept B / Acct X** (or any combo) with an active budget

### Steps

| # | Action | What to do exactly |
|---|--------|--------------------|
| 1 | Open new BTJ | `Customization > Lists, Records & Fields > Record Types > Budget Transfer Journal > New` |
| 2 | Set Subsidiary | Choose your test subsidiary from the dropdown |
| 3 | Set Budget Year | Select the active financial year |
| 4 | Enter Justification | Type: `"T01 - Happy flow test"` |
| 5 | Save Header | Click **Save** (creates empty Draft record, generates ID BTJ0000x) |
| 6 | Click Edit | Click **Edit** on the saved record. The **Lines** subtab is now visible! |
| 7 | Go to **Lines** subtab | Click the Lines tab |
| 8 | Add Line 1 | Click **Add** → Set Department = Dept A, Account = Acct X |
| 9 | Wait for auto-populate | **Pause 2 seconds** — watch Original, Current, and Funds Available fields auto-fill |
| 10 | Enter Decrease | Type `50000` in the Decrease column |
| 11 | Click out of the line | Click another field to trigger `validateLine` |
| 12 | Add Line 2 | Click **Add** → Set Department = Dept B, Account = Acct X |
| 13 | Wait for auto-populate | Verify Original + Funds Available fill in |
| 14 | Enter Increase | Type `50000` in the Increase column |
| 15 | Click out | Click another field |
| 16 | Check footer | Look at bottom of form for Total Increase / Total Decrease fields |
| 17 | Attach memo | Click **Supporting Memo** field → attach any PDF |
| 18 | Save | Click **Save** |

### Expected Results

| Check | Expected |
|-------|----------|
| Line 1 Original | Populated automatically from Custom Budget |
| Line 1 Funds Available | Populated automatically (should be ≥ 50,000) |
| Line 2 Original | Populated automatically |
| Footer Total Increase | **50,000.00** |
| Footer Total Decrease | **50,000.00** |
| Record saves | ✅ No error — record saved with status **Draft** |
| Record Number | Auto-generated (e.g. BTJ00001) |

### ❌ Fail If
- Any field stays blank after selecting Dept/Account
- Save throws a validation error
- Status is anything other than Draft

---

## T02 – Unbalanced Validation (R01)

**Purpose:** Confirm the client script blocks saving when increases ≠ decreases.

### Pre-conditions
- Same budget lines as T01

### Steps

| # | Action | What to do exactly |
|---|--------|--------------------|
| 1 | Open new BTJ | New Budget Transfer Journal |
| 2 | Set Subsidiary, Year, Justification | Any valid values |
| 3 | Save & Edit to add lines | Save header, then Edit |
| 4 | Add Line 1 | Dept A / Acct X → Decrease: **60,000** |
| 5 | Add Line 2 | Dept B / Acct X → Increase: **50,000** |
| 6 | Attach memo | Attach any PDF |
| 7 | Attempt to Save | Click **Save** |

### Expected Results

| Check | Expected |
|-------|----------|
| Footer Total Increase | **50,000.00** |
| Footer Total Decrease | **60,000.00** |
| Save blocked | ✅ Pop-up appears: *"Rule R01 Violation: Total Increases (50000) must equal Total Decreases (60000). Transfer must balance to zero."* |
| Record NOT saved | Stays on entry screen |

### ❌ Fail If
- Record saves despite the imbalance
- No error message appears

---

## T03 – Exceed Funds Available (R02)

**Purpose:** Confirm the system blocks a decrease that exceeds available budget.

### Pre-conditions
- Know the exact **Funds Available** value for Dept A / Acct X (note it from T01)

### Steps

| # | Action | What to do exactly |
|---|--------|--------------------|
| 1 | Open new BTJ | New Budget Transfer Journal |
| 2 | Set Subsidiary, Year, Justification | Any valid values |
| 3 | Save header & Edit | Go to Lines |
| 4 | Add Line 1 | Dept A / Acct X → wait for Funds Available to populate (e.g. 50,000) |
| 5 | Enter Decrease | Type a value **greater** than Funds Available (e.g. `999999`) |
| 6 | Click out of line | Click another field to trigger `validateLine` |

### Expected Results

| Check | Expected |
|-------|----------|
| Immediate pop-up | ✅ *"Rule R02: Decrease (999999) exceeds Funds Available (50000)."* |
| Line is blocked | Cannot commit the line / save is blocked |

### Variant: Try to save anyway (server-side catch)
- If client popup is dismissed — attempt Save
- Server-side `beforeSubmit` in `amt_btj_ue.js` should also throw the same R02 error

### ❌ Fail If
- No popup appears when amount exceeds available
- Record saves with an over-budget decrease

---

## T04 – Missing Budget Record (R05)

**Purpose:** Confirm the system handles a Dept/Account combo with no active budget gracefully.

### Pre-conditions
- Know a Department + Account combination that has **no** active budget line in `customtransaction_bm_budget_transaction`

### Steps

| # | Action | What to do exactly |
|---|--------|--------------------|
| 1 | Open new BTJ | New Budget Transfer Journal |
| 2 | Set Subsidiary, Year, Justification | Any valid values |
| 3 | Save header & Edit | Go to Lines subtab |
| 4 | Select Department | Choose a valid Department |
| 5 | Select Account | Choose an Account that has **no** budget for this Department in the selected Year |
| 6 | Wait | Pause 2–3 seconds |

### Expected Results

| Check | Expected |
|-------|----------|
| Alert popup | ✅ *"Rule R05 Violation: No active budget record found for this Department and Account combination in the selected budget year."* |
| Account field cleared | Account field resets to blank automatically |
| Budget Ref cleared | `custrecord_amt_btjl_budget_ref` is blank |
| Original / Funds Available | Remain blank / 0 |

### ❌ Fail If
- No popup appears
- Fields populate with incorrect/zero values without a warning
- User can save a line with no budget reference

---

## T05 – Missing Supporting Memo (R08)

**Purpose:** Confirm submission is blocked when no memo is attached.

### Pre-conditions
- A balanced transfer with valid lines ready to save

### Steps

| # | Action | What to do exactly |
|---|--------|--------------------|
| 1 | Open new BTJ | New Budget Transfer Journal |
| 2 | Fill all fields | Subsidiary, Year, Justification, balanced Lines (50k/50k) |
| 3 | **Leave Supporting Memo blank** | Do NOT attach any file |
| 4 | Save | Click Save — record should save as Draft |
| 5 | Submit for approval | Click the **Submit for Approval** button / workflow transition button |

### Expected Results

| Check | Expected |
|-------|----------|
| Save (Step 4) | ✅ Saves as Draft — no memo required at Draft stage |
| Submit (Step 5) | ❌ Blocked — error: *"Supporting Memo must be attached before submission (Rule R08)."* |
| Status stays Draft | Record does not move to Pending Approval |

### ❌ Fail If
- Submission succeeds without a memo attached
- Error fires at Save (Draft) instead of Submit

---

## T06 – Approval Routing & Segregation of Duties

**Purpose:** Confirm the WFA routing script sends the transfer to the correct approver and that the requestor cannot approve their own transfer.

### Pre-conditions
- Setup record configured with a **Senior Manager** approver (different from the test requestor)
- Two sandbox user logins ready: **User A** (requestor) and **Finance Manager** (approver)

### Steps

| # | Action | What to do exactly |
|---|--------|--------------------|
| 1 | Log in as **User A** | Switch to a non-admin role that can create BTJ records |
| 2 | Create a balanced BTJ | Follow T01 steps — attach a memo |
| 3 | Save | Record saves as Draft |
| 4 | Submit for approval | Click Submit — workflow fires WFA `route` action |
| 5 | Check **Next Approver** field | Should auto-populate with the Senior Manager from Setup |
| 6 | Check **Status** | Should be **Pending Approval** |
| 7 | Verify User A cannot approve | Look at the record — no Approve / Reject buttons visible for User A |
| 8 | **Log out / switch to Finance Manager** | Use role switcher or separate browser session |
| 9 | Open the same BTJ record | Navigate to the record |
| 10 | Check buttons | **Approve** and **Reject** buttons visible |
| 11 | Check email | Finance Manager's inbox has a notification email about the pending transfer |

### Expected Results

| Check | Expected |
|-------|----------|
| Status after Submit | **Pending Approval** |
| Next Approver field | Populated with Finance Manager name |
| User A sees | Read-only record, no action buttons |
| Finance Manager sees | Approve / Reject buttons |
| Email received | Notification email in Finance Manager's inbox |

### ❌ Fail If
- Next Approver field remains blank
- Status does not change to Pending Approval
- Requestor can see / click Approve

---

## T07 – Post Execution & Budget Verification

**Purpose:** Confirm that approving a transfer triggers the Map/Reduce and correctly updates the Custom Budget.

### Pre-conditions
- Record from T06 is in **Pending Approval** state
- Note the **exact current values** of both budget lines before approving:
  - Dept A / Acct X: Original = X, Transfers = Y, Current = Z
  - Dept B / Acct X: Original = A, Transfers = B, Current = C

### Steps

| # | Action | What to do exactly |
|---|--------|--------------------|
| 1 | Log in as Finance Manager | (Same session from T06 Step 8) |
| 2 | Open the Pending BTJ record | — |
| 3 | Click **Approve** | Workflow transitions to Approved; WFA `post` action fires; MR task is submitted |
| 4 | Check status immediately | Should show **Approved** |
| 5 | **Wait 30–60 seconds** | Map/Reduce runs asynchronously in the background |
| 6 | Refresh the record | Press F5 or navigate away and back |
| 7 | Check final status | Should now show **Posted** |
| 8 | Check **Posted On** field | Should have a timestamp |
| 9 | Open Custom Budget — Dept A / Acct X | Navigate to the Custom Budget transaction |
| 10 | Verify Dept A values | Transfers column should be **previous Transfers − 50,000** |
| 11 | Open Custom Budget — Dept B / Acct X | — |
| 12 | Verify Dept B values | Transfers column should be **previous Transfers + 50,000** |

### Expected Results

| Check | Expected |
|-------|----------|
| Status after Approve | **Approved** immediately |
| Status after MR | **Posted** (within ~60 seconds) |
| Posted On | Timestamp populated |
| Dept A Transfers column | Decreased by 50,000 |
| Dept B Transfers column | Increased by 50,000 |
| Original Budget (both) | **Unchanged** — must not be touched |
| Current Budget (both) | = Original + new Transfers value |

### ❌ Fail If
- Status stays Approved and never moves to Posted
- Original Budget values change
- Transfers column does not update on either budget line
- Posted On remains blank

---

## T08 – Rejection Flow

**Purpose:** Confirm rejection sets the correct status, captures the reason, and notifies the requestor.

### Pre-conditions
- A fresh BTJ submitted by User A, in **Pending Approval** state
- Finance Manager logged in

### Steps

| # | Action | What to do exactly |
|---|--------|--------------------|
| 1 | As Finance Manager, open a Pending BTJ | — |
| 2 | Click **Reject** without entering a reason | Attempt to reject with **Rejection Reason** field blank |
| 3 | Check if blocked | Expected: error or popup requiring a reason |
| 4 | Enter a rejection reason | Type: `"T08 - Budget transfer not aligned with Q4 plan"` |
| 5 | Click **Reject** again | Confirm rejection |
| 6 | Check status | Should be **Rejected** |
| 7 | Check Rejection Reason field | Should display the reason entered |
| 8 | Switch back to User A | Log in / switch role |
| 9 | Open the rejected BTJ | — |
| 10 | Check record is read-only | Lines and header fields should be locked |
| 11 | Check email | User A should have received a rejection notification |
| 12 | Check for Revise button | If re-open path is configured — a **Revise / Re-open** button should appear |

### Expected Results

| Check | Expected |
|-------|----------|
| Reject without reason | ❌ Blocked (if workflow enforces mandatory reason field) |
| Status after rejection | **Rejected** |
| Rejection Reason | Captured and visible |
| Record for User A | Fully read-only |
| Email to User A | Rejection notification received |

> [!NOTE]
> The **Revise/Re-open** button is not yet implemented in the current scripts. If step 12 fails, this is a known gap — raise it as a backlog item.

### ❌ Fail If
- Rejection succeeds without a reason being captured
- Status does not update to Rejected
- Record remains editable after rejection
- No email is sent to User A

---

## T09 – Backup Approver Routing

**Purpose:** Confirm that enabling **Use Backup** on the Setup record reroutes approval to the Backup Approver.

### Pre-conditions
- Setup record exists with both Senior Manager and Backup Approver defined

### Steps

| # | Action | What to do exactly |
|---|--------|--------------------|
| 1 | Open the **Budget Transfer Approval Setup** record | `Customization > Lists, Records & Fields > Record Types > Budget Transfer Approval Setup` |
| 2 | Check **Use Backup** = ✅ | Tick the Use Backup checkbox |
| 3 | Save Setup | — |
| 4 | As User A, create a new BTJ | Balanced transfer, attach memo |
| 5 | Save and Submit | — |
| 6 | Check **Next Approver** field | Should show the **Backup Approver** NOT the Senior Manager |
| 7 | Check Status | **Pending Approval** |
| 8 | Log in as **Backup Approver** | Switch session |
| 9 | Open the BTJ record | Should see Approve / Reject buttons |
| 10 | Log in as **Senior Manager** | Switch session |
| 11 | Open the same BTJ | Senior Manager should NOT see Approve / Reject buttons |
| 12 | After test — reset Setup | Uncheck Use Backup and save Setup record |

### Expected Results

| Check | Expected |
|-------|----------|
| Next Approver field | **Backup Approver** (not Senior Manager) |
| Backup Approver | Sees action buttons |
| Senior Manager | Does NOT see action buttons |
| Status | **Pending Approval** |

### Bonus — Segregation check (requestor = Senior Manager)
If the requestor IS the Senior Manager:
- The routing script includes logic: `if (smApprover === requestor) → use backup`
- Even without **Use Backup** ticked, the system should auto-route to Backup

| # | Action |
|---|--------|
| 1 | Log in as the **Senior Manager user** |
| 2 | Create and submit a BTJ |
| 3 | Check Next Approver → should be **Backup Approver** automatically |

### ❌ Fail If
- Next Approver still shows the Senior Manager when Use Backup is checked
- Backup Approver cannot see action buttons
- Senior Manager can approve their own transfer

---

## 📊 Test Summary Sheet

| Test | Scenario | Status | Notes |
|------|----------|--------|-------|
| T01 | Happy Flow & Balance | ⬜ | — |
| T02 | Unbalanced (R01) | ⬜ | — |
| T03 | Exceed Funds Available (R02) | ⬜ | — |
| T04 | Missing Budget Record (R05) | ⬜ | — |
| T05 | Missing Memo (R08) | ⬜ | — |
| T06 | Approval Routing & SOD | ⬜ | — |
| T07 | Post & Budget Verification | ⬜ | — |
| T08 | Rejection Flow | ⬜ | Known gap: Revise button not built |
| T09 | Backup Approver Routing | ⬜ | — |

> Update Status column: ✅ Pass | ❌ Fail | ⚠️ Partial | ⬜ Not Run
