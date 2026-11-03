/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * amt_btj_post_mr.js - Applies approved transfer lines to the ACTIVE budget transaction's lines.
 *
 * - getInputData: unposted lines of the Approved transfer(s)
 * - map:          groups lines by budget transaction (so each budget is loaded and saved once)
 * - reduce:       locks the budget, finds each budget line (verifying department + account),
 *                 updates Transfers and Current, saves once, and reports a result per transfer line
 * - summarize:    marks the lines that posted (single-threaded, so no record collisions) and sets the
 *                 final status on each transfer. Lines that posted stay marked even if a sibling failed,
 *                 so a retry never posts the same line twice.
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log', './amt_btj_lib', './amt_btj_budget'], (record, search, runtime, log, lib, budgetLib) => {

    const L = {
        posted: 'custrecord_amt_btjl_posted',
        budgetRef: 'custrecord_amt_btjl_budget_ref',
        lineKey: 'custrecord_amt_btjl_line_key',
        department: 'custrecord_amt_btjl_department',
        account: 'custrecord_amt_btjl_account',
        increase: 'custrecord_amt_btjl_increase',
        decrease: 'custrecord_amt_btjl_decrease',
        before: 'custrecord_amt_btjl_before',
        after: 'custrecord_amt_btjl_after'
    };

    function num(v) {
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    }

    function isBlank(v) {
        return v === '' || v === null || v === undefined;
    }

    function round2(n) {
        return Math.round(n * 100) / 100;
    }

    function getInputData() {
        const script = runtime.getCurrentScript();
        const transferId = script.getParameter({ name: 'custscript_amt_btj_mr_transfer' });
        const config = lib.loadConfig();

        const transferIds = [];
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
        transferIds.forEach((tId) => {
            const tRec = record.load({ type: 'customrecord_amt_btj', id: tId });
            const lineCount = tRec.getLineCount({ sublistId: config.lineSublist });
            const get = (fieldId, i) => tRec.getSublistValue({ sublistId: config.lineSublist, fieldId: fieldId, line: i });

            for (let i = 0; i < lineCount; i++) {
                if (get(L.posted, i)) continue;
                linesData.push({
                    transferId: String(tId),
                    lineIndex: i,
                    budgetRef: get(L.budgetRef, i),
                    lineKey: get(L.lineKey, i),
                    department: get(L.department, i),
                    account: get(L.account, i),
                    increase: num(get(L.increase, i)),
                    decrease: num(get(L.decrease, i))
                });
            }
        });
        return linesData;
    }

    function map(context) {
        const line = JSON.parse(context.value);
        // Key by budget transaction so all lines for one budget are applied in a single load/save.
        context.write({
            key: line.budgetRef ? String(line.budgetRef) : 'NO_BUDGET',
            value: line
        });
    }

    // One result per transfer line, so summarize can mark exactly what happened.
    function writeResults(context, lines, success, error, balances) {
        lines.forEach((l) => {
            const b = balances && balances[l.transferId + ':' + l.lineIndex];
            context.write({
                key: l.transferId,
                value: JSON.stringify({
                    lineIndex: l.lineIndex,
                    success: success,
                    before: b ? b.before : null,
                    after: b ? b.after : null,
                    error: error || null
                })
            });
        });
    }

    function reduce(context) {
        const budgetRef = context.key;
        const lines = context.values.map(v => JSON.parse(v));
        const b = lib.loadConfig().budgetRecord;

        if (budgetRef === 'NO_BUDGET') {
            writeResults(context, lines, false, 'Line has no budget record (Rule R05).');
            return;
        }

        if (!budgetLib.acquireLock(budgetRef)) {
            writeResults(context, lines, false, `Budget ${budgetRef} is being updated by another posting. Retry later.`);
            return;
        }

        try {
            const bRec = record.load({ type: b.type, id: budgetRef, isDynamic: false });
            const get = (fieldId, i) => bRec.getSublistValue({ sublistId: b.lineSublist, fieldId: fieldId, line: i });
            const balances = {};

            // Group transfer lines by the budget line they hit.
            const groups = {};
            lines.forEach((l) => {
                const k = [l.lineKey, l.department, l.account].join('|');
                (groups[k] = groups[k] || []).push(l);
            });

            Object.keys(groups).forEach((k) => {
                const g = groups[k];
                const idx = budgetLib.locateBudgetLine(bRec, g[0].lineKey, g[0].department, g[0].account);
                if (idx < 0) {
                    throw new Error(`Budget line not found on budget ${budgetRef} for department ${g[0].department} / account ${g[0].account}.`);
                }

                const origRaw = get(b.original, idx);
                const trRaw = get(b.transfers, idx);
                const lineAmt = Math.abs(num(get('amount', idx)) || num(get('debit', idx)) || num(get('credit', idx)));
                const original = isBlank(origRaw) ? lineAmt : num(origRaw);
                let transfers = isBlank(trRaw) ? 0 : num(trRaw);

                // Running before/after per transfer line, in a stable order.
                g.sort((x, y) => (x.transferId === y.transferId ? x.lineIndex - y.lineIndex : Number(x.transferId) - Number(y.transferId)));
                g.forEach((l) => {
                    const before = transfers;
                    transfers = round2(transfers + l.increase - l.decrease);
                    balances[l.transferId + ':' + l.lineIndex] = { before: before, after: transfers };
                });

                const current = round2(original + transfers);
                if (current < 0) {
                    throw new Error(`Posting would make the budget negative (department ${g[0].department} / account ${g[0].account}: ${current}).`);
                }

                if (isBlank(origRaw)) bRec.setSublistValue({ sublistId: b.lineSublist, fieldId: b.original, line: idx, value: original });
                bRec.setSublistValue({ sublistId: b.lineSublist, fieldId: b.transfers, line: idx, value: transfers });
                bRec.setSublistValue({ sublistId: b.lineSublist, fieldId: b.current, line: idx, value: current });
                log.audit('Budget line updated', `budget ${budgetRef} line ${idx}: original=${original}, transfers=${transfers}, current=${current}`);
            });

            bRec.save({ enableSourcing: false, ignoreMandatoryFields: true });
            writeResults(context, lines, true, null, balances);
        } catch (e) {
            log.error('reduce error on budget ' + budgetRef, e.message);
            writeResults(context, lines, false, e.message);
        } finally {
            budgetLib.releaseLock(budgetRef);
        }
    }

    function summarize(summary) {
        const config = lib.loadConfig();

        if (summary.inputSummary.error) log.error('Post input error', summary.inputSummary.error);
        summary.mapSummary.errors.iterator().each((key, error) => {
            log.error('Post map error', `${key}: ${error}`);
            return true;
        });
        summary.reduceSummary.errors.iterator().each((key, error) => {
            log.error('Post reduce error (budget ' + key + ')', error);
            return true;
        });

        const byTransfer = {};
        summary.output.iterator().each((key, value) => {
            (byTransfer[key] = byTransfer[key] || []).push(JSON.parse(value));
            return true;
        });

        Object.keys(byTransfer).forEach((tId) => {
            const results = byTransfer[tId];
            const tRec = record.load({ type: 'customrecord_amt_btj', id: tId });

            // Mark every line that really posted, even if a sibling line failed.
            results.forEach((r) => {
                if (!r.success) return;
                tRec.setSublistValue({ sublistId: config.lineSublist, fieldId: L.before, line: r.lineIndex, value: r.before });
                tRec.setSublistValue({ sublistId: config.lineSublist, fieldId: L.after, line: r.lineIndex, value: r.after });
                tRec.setSublistValue({ sublistId: config.lineSublist, fieldId: L.posted, line: r.lineIndex, value: true });
            });

            const failed = results.filter(r => !r.success);
            if (failed.length === 0) {
                tRec.setValue({ fieldId: 'custrecord_amt_btj_status', value: config.status.posted });
                tRec.setValue({ fieldId: 'custrecord_amt_btj_posted_on', value: new Date() });
                log.audit('POSTED_SUCCESS', `Transfer ${tId} posted successfully (${results.length} line(s)).`);
            } else {
                const msgs = failed.map(r => r.error).filter((m, i, a) => a.indexOf(m) === i).join('; ');
                tRec.setValue({ fieldId: 'custrecord_amt_btj_status', value: config.status.error });
                tRec.setValue({ fieldId: 'custrecord_amt_btj_error', value: msgs });
                log.error('POSTED_ERROR', `Transfer ${tId}: ${failed.length} of ${results.length} line(s) failed: ${msgs}`);
            }
            tRec.save();
        });
    }

    return {
        getInputData,
        map,
        reduce,
        summarize
    };
});
