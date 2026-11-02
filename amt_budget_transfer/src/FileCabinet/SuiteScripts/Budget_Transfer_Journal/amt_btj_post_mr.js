/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * amt_btj_post_mr.js - Applies approved transfer lines to Custom Budget with safe retry
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log', './amt_btj_lib', './amt_btj_budget'], (record, search, runtime, log, lib, budgetLib) => {

    function getInputData() {
        const script = runtime.getCurrentScript();
        let transferId = script.getParameter({ name: 'custscript_amt_btj_mr_transfer' });
        const config = lib.loadConfig();

        let transferIds = [];
        if (transferId) {
            transferIds.push(transferId);
        } else {
            // Sweeper run: find all Approved transfers
            search.create({
                type: 'customrecord_amt_btj',
                filters: [['custrecord_amt_btj_status', 'anyof', config.status.approved]],
                columns: ['internalid']
            }).run().each((res) => {
                transferIds.push(res.id);
                return true;
            });
        }

        // Return all unposted lines for these transfers
        const linesData = [];
        for (const tId of transferIds) {
            const tRec = record.load({ type: 'customrecord_amt_btj', id: tId });
            const lineCount = tRec.getLineCount({ sublistId: config.lineSublist });

            for (let i = 0; i < lineCount; i++) {
                const isPosted = tRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_posted', line: i });
                if (!isPosted) {
                    linesData.push({
                        transferId: tId,
                        lineIndex: i,
                        budgetRef: tRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_budget_ref', line: i }),
                        increase: parseFloat(tRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_increase', line: i }) || 0),
                        decrease: parseFloat(tRec.getSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_decrease', line: i }) || 0)
                    });
                }
            }
        }
        return linesData;
    }

    function map(context) {
        const line = JSON.parse(context.value);
        // Key by budget record so updates to the same budget record aggregate
        context.write({
            key: line.budgetRef,
            value: line
        });
    }

    function reduce(context) {
        const budgetRef = context.key;
        const lines = context.values.map(v => JSON.parse(v));
        const config = lib.loadConfig();
        const bConf = config.budgetRecord;

        let netMovement = 0;
        for (const l of lines) {
            netMovement += (l.increase - l.decrease);
        }

        budgetLib.acquireLock(budgetRef);
        try {
            // Update Custom Budget record
            const bRec = record.load({ type: bConf.type, id: budgetRef });
            const currentTransfers = parseFloat(bRec.getValue({ fieldId: bConf.transfers }) || 0);
            const newTransfers = currentTransfers + netMovement;
            const original = parseFloat(bRec.getValue({ fieldId: bConf.original }) || 0);

            bRec.setValue({ fieldId: bConf.transfers, value: newTransfers });
            bRec.setValue({ fieldId: bConf.current, value: original + newTransfers });
            bRec.save();

            // Mark lines as posted
            for (const l of lines) {
                const tRec = record.load({ type: 'customrecord_amt_btj', id: l.transferId });
                tRec.setSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_before', line: l.lineIndex, value: currentTransfers });
                tRec.setSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_after', line: l.lineIndex, value: newTransfers });
                tRec.setSublistValue({ sublistId: config.lineSublist, fieldId: 'custrecord_amt_btjl_posted', line: l.lineIndex, value: true });
                tRec.save();
            }
            context.write({ key: lines[0].transferId, value: { success: true } });
        } catch (e) {
            log.error('reduce error on budgetRef ' + budgetRef, e.message);
            context.write({ key: lines[0].transferId, value: { success: false, error: e.message } });
        } finally {
            budgetLib.releaseLock(budgetRef);
        }
    }

    function summarize(summary) {
        const config = lib.loadConfig();
        const processedTransfers = {};

        summary.output.iterator().each((key, value) => {
            const res = JSON.parse(value);
            if (!processedTransfers[key]) {
                processedTransfers[key] = { success: true, errors: [] };
            }
            if (!res.success) {
                processedTransfers[key].success = false;
                processedTransfers[key].errors.push(res.error);
            }
            return true;
        });

        for (const tId in processedTransfers) {
            const item = processedTransfers[tId];
            const tRec = record.load({ type: 'customrecord_amt_btj', id: tId });
            if (item.success) {
                tRec.setValue({ fieldId: 'custrecord_amt_btj_status', value: config.status.posted });
                tRec.setValue({ fieldId: 'custrecord_amt_btj_posted_on', value: new Date() });
                log.audit('POSTED_SUCCESS', `Transfer ${tId} posted successfully.`);
            } else {
                tRec.setValue({ fieldId: 'custrecord_amt_btj_status', value: config.status.error });
                tRec.setValue({ fieldId: 'custrecord_amt_btj_error', value: item.errors.join('; ') });
                log.error('POSTED_ERROR', `Transfer ${tId} encountered errors: ${item.errors.join('; ')}`);
            }
            tRec.save();
        }
    }

    return {
        getInputData,
        map,
        reduce,
        summarize
    };
});
