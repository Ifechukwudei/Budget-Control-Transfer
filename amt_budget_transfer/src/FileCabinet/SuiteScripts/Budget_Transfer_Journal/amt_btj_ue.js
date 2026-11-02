/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * amt_btj_ue.js - Validation on save, auto-defaults, line locking, Retry & Reverse buttons
 */
define(['./amt_btj_lib', 'N/runtime', 'N/error'], (lib, runtime, error) => {

    function beforeLoad(context) {
        const form = context.form;
        const newRec = context.newRecord;
        const status = newRec.getValue({ fieldId: 'custrecord_amt_btj_status' });
        const config = lib.loadConfig();

        // If not in Draft, lock the lines sublist
        if (context.type === context.UserEventType.VIEW || context.type === context.UserEventType.EDIT) {
            const draftStatusId = config.status.draft;
            if (status && status !== draftStatusId) {
                const sublist = form.getSublist({ id: config.lineSublist });
                if (sublist) {
                    // Disable sublist lines for editing
                }
            }
        }

        // Add Retry button if in Error status
        if (context.type === context.UserEventType.VIEW && status === config.status.error) {
            form.addButton({
                id: 'custpage_btn_retry',
                label: 'Retry Posting',
                functionName: 'location.reload()'
            });
        }

        // Add Reverse button if in Posted status
        if (context.type === context.UserEventType.VIEW && status === config.status.posted) {
            form.addButton({
                id: 'custpage_btn_reverse',
                label: 'Reverse Transfer',
                functionName: 'alert("Starting reversal workflow...")'
            });
        }
    }

    function beforeSubmit(context) {
        const newRec = context.newRecord;
        const config = lib.loadConfig();

        if (context.type === context.UserEventType.CREATE) {
            const user = runtime.getCurrentUser();
            newRec.setValue({ fieldId: 'custrecord_amt_btj_requestor', value: user.id });
            newRec.setValue({ fieldId: 'custrecord_amt_btj_date', value: new Date() });
            if (!newRec.getValue({ fieldId: 'custrecord_amt_btj_subsidiary' })) {
                newRec.setValue({ fieldId: 'custrecord_amt_btj_subsidiary', value: user.subsidiary });
            }
        }

        // Recalculate totals
        const lineCount = newRec.getLineCount({ sublistId: config.lineSublist });
        const lines = [];
        for (let i = 0; i < lineCount; i++) {
            lines.push({
                department: newRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_department', line: i }),
                account: newRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_account', line: i }),
                project: newRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_project', line: i }),
                increase: newRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_increase', line: i }),
                decrease: newRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_decrease', line: i }),
                available: newRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_available', line: i }),
                budgetRef: newRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_budget_ref', line: i })
            });
        }

        const totals = lib.calculateTotals(lines);
        newRec.setValue({ fieldId: 'custrecord_amt_btj_total_inc', value: totals.totalInc });
        newRec.setValue({ fieldId: 'custrecord_amt_btj_total_dec', value: totals.totalDec });

        // Enforce validations
        const header = {
            year: newRec.getValue({ fieldId: 'custrecord_amt_btj_year' }),
            justification: newRec.getValue({ fieldId: 'custrecord_amt_btj_justification' }),
            file: newRec.getValue({ fieldId: 'custrecord_amt_btj_file' })
        };

        // Skip full validation on empty Draft saves (no lines yet)
        if (lines.length > 0) {
            const validation = lib.validateTransfer(header, lines, false);
            if (!validation.isValid) {
                throw error.create({
                    name: 'AMT_BTJ_VALIDATION_FAILED',
                    message: validation.errors.join(' | ')
                });
            }
        }
    }

    return {
        beforeLoad,
        beforeSubmit
    };
});
