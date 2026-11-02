/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 * @NModuleScope SameAccount
 *
 * amt_btj_wfa.js - Reads Approval Setup record, resolves Senior Manager/Backup/GM routing, and starts Map/Reduce posting
 */
define(['N/search', 'N/task', 'N/log', 'N/runtime', './amt_btj_lib'], (search, task, log, runtime, lib) => {

    function onAction(context) {
        const newRec = context.newRecord;
        const config = lib.loadConfig();
        const actionType = runtime.getCurrentScript().getParameter({ name: 'custscript_amt_btj_wfa_action' });

        log.debug('amt_btj_wfa', `Executing action: ${actionType} for Transfer: ${newRec.id}`);

        if (actionType === 'route') {
            const subId = newRec.getValue({ fieldId: 'custrecord_amt_btj_subsidiary' });
            const requestor = newRec.getValue({ fieldId: 'custrecord_amt_btj_requestor' });

            // Lookup setup record for subsidiary
            let smApprover = null;
            let backupApprover = null;
            let useBackup = false;
            let gmApprovalOn = false;
            let gmApprover = null;
            let gmThreshold = 0;

            const setupSearch = search.create({
                type: 'customrecord_amt_btj_setup',
                filters: [['custrecord_amt_btjs_subsidiary', 'anyof', subId]],
                columns: [
                    'custrecord_amt_btjs_approver',
                    'custrecord_amt_btjs_backup',
                    'custrecord_amt_btjs_use_backup',
                    'custrecord_amt_btjs_gm_on',
                    'custrecord_amt_btjs_gm',
                    'custrecord_amt_btjs_gm_threshold'
                ]
            });

            setupSearch.run().each((res) => {
                smApprover = res.getValue('custrecord_amt_btjs_approver');
                backupApprover = res.getValue('custrecord_amt_btjs_backup');
                useBackup = res.getValue('custrecord_amt_btjs_use_backup');
                gmApprovalOn = res.getValue('custrecord_amt_btjs_gm_on');
                gmApprover = res.getValue('custrecord_amt_btjs_gm');
                gmThreshold = parseFloat(res.getValue('custrecord_amt_btjs_gm_threshold') || 0);
                return false;
            });

            // Decide Next Approver
            let targetApprover = smApprover;
            if (useBackup || (smApprover && String(smApprover) === String(requestor))) {
                targetApprover = backupApprover;
            }

            newRec.setValue({ fieldId: 'custrecord_amt_btj_next_approver', value: targetApprover });

            // Return GM decision flag for workflow state transition
            const totalDec = parseFloat(newRec.getValue({ fieldId: 'custrecord_amt_btj_total_dec' }) || 0);
            if (gmApprovalOn && totalDec > gmThreshold) {
                return 'GM';
            }
            return 'SM';

        } else if (actionType === 'post') {
            // Trigger Map/Reduce posting
            try {
                const mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: 'customscript_amt_btj_post_mr',
                    deploymentId: 'customdeploy_amt_btj_post_mr',
                    params: {
                        custscript_amt_btj_mr_transfer: newRec.id
                    }
                });
                const taskId = mrTask.submit();
                log.audit('amt_btj_wfa', `Map/Reduce task submitted. ID: ${taskId}`);
            } catch (e) {
                log.error('amt_btj_wfa posting error', 'Map/Reduce queue busy or failed to submit: ' + e.message);
                // Sweeper deployment will pick it up automatically
            }
        }
        return 'DONE';
    }

    return {
        onAction
    };
});
