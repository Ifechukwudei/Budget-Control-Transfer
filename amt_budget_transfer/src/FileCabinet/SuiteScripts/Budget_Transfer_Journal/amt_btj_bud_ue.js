/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * amt_btj_bud_ue.js - OPTIONAL. Deployed on the budget transaction (customtransaction_bm_budget_transaction).
 * Keeps Current Budget = Original Budget + Transfers on every line that has an Original or Transfers value.
 * Lines with both blank (not backfilled yet) are left alone.
 */
define(['./amt_btj_lib', 'N/log'], (lib, log) => {

    function isBlank(v) {
        return v === '' || v === null || v === undefined;
    }

    function beforeSubmit(context) {
        if (context.type === context.UserEventType.DELETE) return;

        const rec = context.newRecord;
        const b = lib.loadConfig().budgetRecord;
        const count = rec.getLineCount({ sublistId: b.lineSublist });
        let changed = 0;

        for (let i = 0; i < count; i++) {
            const get = (fieldId) => rec.getSublistValue({ sublistId: b.lineSublist, fieldId: fieldId, line: i });
            const origRaw = get(b.original);
            const trRaw = get(b.transfers);
            if (isBlank(origRaw) && isBlank(trRaw)) continue;

            const expected = Math.round((parseFloat(origRaw || 0) + parseFloat(trRaw || 0)) * 100) / 100;
            const curRaw = get(b.current);
            if (isBlank(curRaw) || Math.abs(parseFloat(curRaw) - expected) > 0.004) {
                rec.setSublistValue({ sublistId: b.lineSublist, fieldId: b.current, line: i, value: expected });
                changed++;
            }
        }
        if (changed > 0) {
            log.debug('amt_btj_bud_ue', `Recalculated Current Budget on ${changed} line(s).`);
        }
    }

    return { beforeSubmit };
});
