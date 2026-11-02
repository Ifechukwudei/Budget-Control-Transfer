/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 *
 * amt_btj_cs.js - Lookups, real-time totals, line validation, and balance checks
 */
define(['./amt_btj_lib', './amt_btj_budget', 'N/ui/dialog'], (lib, budgetLib, dialog) => {

    function pageInit(context) {
        recalcTotals(context.currentRecord);
    }

    function recalcTotals(currRec) {
        const config = lib.loadConfig();
        const lineCount = currRec.getLineCount({ sublistId: config.lineSublist });
        let totalInc = 0;
        let totalDec = 0;

        for (let i = 0; i < lineCount; i++) {
            totalInc += parseFloat(currRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_increase', line: i }) || 0);
            totalDec += parseFloat(currRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_decrease', line: i }) || 0);
        }

        totalInc = Math.round(totalInc * 100) / 100;
        totalDec = Math.round(totalDec * 100) / 100;
        const diff = Math.round((totalInc - totalDec) * 100) / 100;

        currRec.setValue({ fieldId: 'custrecord_amt_btj_total_inc', value: totalInc, ignoreFieldChange: true });
        currRec.setValue({ fieldId: 'custrecord_amt_btj_total_dec', value: totalDec, ignoreFieldChange: true });
    }

    function fieldChanged(context) {
        const currRec = context.currentRecord;
        const sublistId = context.sublistId;
        const fieldId = context.fieldId;
        const config = lib.loadConfig();

        if (sublistId === config.lineSublist) {
            if (fieldId === 'custrecord_amt_btjl_department' || fieldId === 'custrecord_amt_btjl_account' || fieldId === 'custrecord_amt_btjl_project') {
                const sub = currRec.getValue({ fieldId: 'custrecord_amt_btj_subsidiary' });
                const year = currRec.getText({ fieldId: 'custrecord_amt_btj_year' });
                const dept = currRec.getCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_department' });
                const acct = currRec.getCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_account' });
                const proj = currRec.getCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_project' });

                if (dept && acct) {
                    const found = budgetLib.findBudget({ subsidiary: sub, year: year, department: dept, account: acct, project: proj });
                    if (found) {
                        currRec.setCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_original', value: found.original, ignoreFieldChange: true });
                        currRec.setCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_current', value: found.current, ignoreFieldChange: true });
                        currRec.setCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_available', value: found.available, ignoreFieldChange: true });
                        currRec.setCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_budget_ref', value: found.id, ignoreFieldChange: true });
                    } else {
                        dialog.alert({
                            title: 'No Active Budget',
                            message: 'Rule R05 Violation: No active budget record found for this Department and Account combination in the selected budget year.'
                        });
                        currRec.setCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_account', value: '', ignoreFieldChange: true });
                        currRec.setCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_budget_ref', value: '', ignoreFieldChange: true });
                    }
                }
            } else if (fieldId === 'custrecord_amt_btjl_increase' || fieldId === 'custrecord_amt_btjl_decrease') {
                recalcTotals(currRec);
            }
        }
    }

    function validateLine(context) {
        const currRec = context.currentRecord;
        const sublistId = context.sublistId;
        const config = lib.loadConfig();

        if (sublistId === config.lineSublist) {
            const inc = parseFloat(currRec.getCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_increase' }) || 0);
            const dec = parseFloat(currRec.getCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_decrease' }) || 0);
            const bRef = currRec.getCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_budget_ref' });
            const avail = parseFloat(currRec.getCurrentSublistValue({ sublistId, fieldId: 'custrecord_amt_btjl_available' }) || 0);

            // R03
            if (inc > 0 && dec > 0) {
                dialog.alert({ title: 'Validation Error', message: 'Rule R03: Enter an Increase or Decrease, not both.' });
                return false;
            }
            if (inc <= 0 && dec <= 0) {
                dialog.alert({ title: 'Validation Error', message: 'Rule R03: Amount must be positive.' });
                return false;
            }
            // R05
            if (!bRef) {
                dialog.alert({ title: 'Validation Error', message: 'Rule R05: Cannot add line without an active matched budget.' });
                return false;
            }
            // R02
            if (dec > 0 && dec > avail) {
                dialog.alert({ title: 'Validation Error', message: `Rule R02: Decrease (${dec}) exceeds Funds Available (${avail}).` });
                return false;
            }
        }
        return true;
    }

    function saveRecord(context) {
        const currRec = context.currentRecord;
        recalcTotals(currRec);

        const config = lib.loadConfig();
        const lineCount = currRec.getLineCount({ sublistId: config.lineSublist });

        // Allow saving an empty Draft (no lines yet or sublist not rendered on create)
        // Note: NetSuite returns -1 if the sublist is not present on the current form mode.
        if (lineCount <= 0) return true;

        const totalInc = parseFloat(currRec.getValue({ fieldId: 'custrecord_amt_btj_total_inc' }) || 0);
        const totalDec = parseFloat(currRec.getValue({ fieldId: 'custrecord_amt_btj_total_dec' }) || 0);

        if (totalInc <= 0 || totalDec <= 0 || totalInc !== totalDec) {
            dialog.alert({
                title: 'Unbalanced Transfer',
                message: `Rule R01 Violation: Total Increases (${totalInc}) must equal Total Decreases (${totalDec}). Transfer must balance to zero.`
            });
            return false;
        }
        return true;
    }

    return {
        pageInit,
        fieldChanged,
        validateLine,
        saveRecord
    };
});
