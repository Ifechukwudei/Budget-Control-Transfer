/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * amt_btj_bud_ue.js - Deployed on Custom Budget transaction to ensure Current Budget always equals Original Budget + Transfers
 */
define(['./amt_btj_lib', 'N/log'], (lib, log) => {

    function beforeSubmit(context) {
        const newRec = context.newRecord;
        const config = lib.loadConfig();
        const bConf = config.budgetRecord;

        const orig = parseFloat(newRec.getValue({ fieldId: bConf.original }) || 0);
        const trans = parseFloat(newRec.getValue({ fieldId: bConf.transfers }) || 0);
        const expectedCurrent = Math.round((orig + trans) * 100) / 100;

        newRec.setValue({
            fieldId: bConf.current,
            value: expectedCurrent
        });
        log.debug('amt_btj_bud_ue', `Recalculated Current Budget to: ${expectedCurrent}`);
    }

    return {
        beforeSubmit
    };
});
