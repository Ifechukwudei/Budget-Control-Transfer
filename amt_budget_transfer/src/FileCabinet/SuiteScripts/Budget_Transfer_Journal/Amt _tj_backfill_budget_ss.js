/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 *
 * amt_btj_backfill_budget_ss.js - TEST/BACKFILL ONLY.
 * Fills blank Original / Transfers / Current Budget columns on a budget transaction's lines.
 * Existing values are never overwritten, so it is safe to run more than once.
 *
 * Script parameters (create these on the script record, Parameters tab):
 *   custscript_amt_btj_bf_txn_id   Free-Form Text  - budget transaction internal ID (required)
 *   custscript_amt_btj_bf_dept     List/Record Department - only update this department (optional)
 *   custscript_amt_btj_bf_acct     List/Record Account    - only update this account (optional)
 *   custscript_amt_btj_bf_amount   Currency - test amount to use as Original (optional;
 *                                  if empty, the line's own amount is used)
 */
define(['N/record', 'N/runtime', 'N/log'], (record, runtime, log) => {

    const TXN_TYPE = 'customtransaction_bm_budget_transaction';
    const SUBLIST = 'line';
    const COL_ORIGINAL = 'custcol_amt_bud_original';
    const COL_TRANSFERS = 'custcol_amt_bud_transfers';
    const COL_CURRENT = 'custcol_amt_bud_current';

    function isBlank(v) {
        return v === '' || v === null || v === undefined;
    }

    function num(v) {
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    }

    function execute() {
        const script = runtime.getCurrentScript();
        const txnId = script.getParameter({ name: 'custscript_amt_btj_bf_txn_id' });
        const deptFilter = script.getParameter({ name: 'custscript_amt_btj_bf_dept' });
        const acctFilter = script.getParameter({ name: 'custscript_amt_btj_bf_acct' });
        const testAmount = script.getParameter({ name: 'custscript_amt_btj_bf_amount' });

        if (!txnId) {
            log.error('Backfill', 'Parameter custscript_amt_btj_bf_txn_id is required.');
            return;
        }

        const rec = record.load({ type: TXN_TYPE, id: txnId, isDynamic: false });
        const lineCount = rec.getLineCount({ sublistId: SUBLIST });
        let changed = 0;

        for (let i = 0; i < lineCount; i++) {
            const dept = rec.getSublistValue({ sublistId: SUBLIST, fieldId: 'department', line: i });
            const acct = rec.getSublistValue({ sublistId: SUBLIST, fieldId: 'account', line: i });

            if (deptFilter && String(dept) !== String(deptFilter)) continue;
            if (acctFilter && String(acct) !== String(acctFilter)) continue;

            const origCur = rec.getSublistValue({ sublistId: SUBLIST, fieldId: COL_ORIGINAL, line: i });
            const trCur = rec.getSublistValue({ sublistId: SUBLIST, fieldId: COL_TRANSFERS, line: i });
            const curCur = rec.getSublistValue({ sublistId: SUBLIST, fieldId: COL_CURRENT, line: i });

            // Line amount: standard 'amount', else debit/credit (custom transaction lines).
            const lineAmt = Math.abs(
                num(rec.getSublistValue({ sublistId: SUBLIST, fieldId: 'amount', line: i })) ||
                num(rec.getSublistValue({ sublistId: SUBLIST, fieldId: 'debit', line: i })) ||
                num(rec.getSublistValue({ sublistId: SUBLIST, fieldId: 'credit', line: i }))
            );

            let original = num(origCur);
            let transfers = num(trCur);

            if (isBlank(origCur)) {
                original = !isBlank(testAmount) ? num(testAmount) : lineAmt;
                rec.setSublistValue({ sublistId: SUBLIST, fieldId: COL_ORIGINAL, line: i, value: original });
            }
            if (isBlank(trCur)) {
                transfers = 0;
                rec.setSublistValue({ sublistId: SUBLIST, fieldId: COL_TRANSFERS, line: i, value: transfers });
            }
            if (isBlank(curCur)) {
                rec.setSublistValue({ sublistId: SUBLIST, fieldId: COL_CURRENT, line: i, value: original + transfers });
            }

            if (isBlank(origCur) || isBlank(trCur) || isBlank(curCur)) {
                changed++;
                log.audit('Backfill line', `line ${i}: dept=${dept}, acct=${acct}, lineAmt=${lineAmt}, original=${original}, transfers=${transfers}, current=${original + transfers}`);
            }
        }

        if (changed === 0) {
            log.audit('Backfill', `Txn ${txnId}: nothing to change (no matching lines with blank columns).`);
            return;
        }

        rec.save({ enableSourcing: false, ignoreMandatoryFields: true });
        log.audit('Backfill', `Txn ${txnId}: updated ${changed} line(s).`);
    }

    return { execute };
});