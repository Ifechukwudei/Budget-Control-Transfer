/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * amt_btj_budget.js - Active budget lookups on the budget transaction's lines, line location, and locks
 */
/**
 * NOTE: N/cache and N/record are server-side-only modules. They must NOT
 * appear in the define() array because this module is also loaded by the
 * Client Script. They are lazy-loaded via require() inside the functions
 * that actually need them (acquireLock / releaseLock), which are never
 * called from the client-side code path.
 */
define(['N/search', 'N/log', './amt_btj_lib'], (search, log, lib) => {

    function isBlank(v) {
        return v === '' || v === null || v === undefined;
    }

    /**
     * Returns { id, startdate, enddate, name } of the fiscal year (period flagged "is a year") that
     * contains the picked period. If the picked period is already a year, it is returned as is.
     */
    function resolveFiscalYear(periodId) {
        const picked = search.lookupFields({
            type: 'accountingperiod',
            id: periodId,
            columns: ['startdate', 'enddate', 'isyear', 'periodname']
        });

        if (picked.isyear === true || picked.isyear === 'T') {
            return { id: String(periodId), startdate: picked.startdate, enddate: picked.enddate, name: picked.periodname };
        }

        let year = null;
        search.create({
            type: 'accountingperiod',
            filters: [
                ['isyear', 'is', 'T'],
                'AND', ['startdate', 'onorbefore', picked.startdate],
                'AND', ['enddate', 'onorafter', picked.enddate]
            ],
            columns: ['internalid', 'periodname', 'startdate', 'enddate']
        }).run().each((res) => {
            year = {
                id: res.id,
                startdate: res.getValue('startdate'),
                enddate: res.getValue('enddate'),
                name: res.getValue('periodname')
            };
            return false;
        });
        return year;
    }

    /**
     * Finds the ACTIVE budget line for a combination.
     *
     * Looks at budget transactions flagged Active Version whose line has the same Subsidiary,
     * Department and Account and whose start/end dates equal the fiscal year of the picked period.
     * If more than one active budget matches, the latest transaction date wins.
     *
     * params: { subsidiary, year (any Accounting Period ID), department, account, project }
     * returns: { id (budget txn), lineKey (line sequence number), ref, original, transfers,
     *            current, available } or null
     */
    function findBudget(params) {
        const config = lib.loadConfig();
        const b = config.budgetRecord;

        if (!params.subsidiary || !params.department || !params.account || !params.year) {
            return null;
        }

        let year;
        try {
            year = resolveFiscalYear(params.year);
        } catch (e) {
            log.error('findBudget year resolution failed', e.message);
            return null;
        }
        if (!year) {
            log.error('findBudget', `No fiscal year found for period ${params.year}`);
            return null;
        }

        console.log('[BTJ findBudget] params', JSON.stringify(params), 'fiscal year', year.name, year.startdate, year.enddate);
        log.debug('findBudget params', JSON.stringify({
            subsidiary: params.subsidiary, pickedPeriod: params.year, fiscalYear: year.name,
            start: year.startdate, end: year.enddate, department: params.department, account: params.account
        }));

        const filters = [
            ['mainline', 'is', 'F'],
            'AND', [b.activeVersion, 'is', 'T'],
            'AND', [b.subsidiary, 'anyof', params.subsidiary],
            'AND', [b.department, 'anyof', params.department],
            'AND', [b.account, 'anyof', params.account],
            'AND', [b.startDate, 'on', year.startdate],
            'AND', [b.endDate, 'on', year.enddate]
        ];
        if (config.useProject && b.project && params.project) {
            filters.push('AND');
            filters.push([b.project, 'anyof', params.project]);
        }

        function runSearch(withAmount) {
            const columns = [
                search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
                search.createColumn({ name: 'internalid', sort: search.Sort.DESC }),
                search.createColumn({ name: 'linesequencenumber' }),
                search.createColumn({ name: b.original }),
                search.createColumn({ name: b.transfers }),
                search.createColumn({ name: b.current })
            ];
            if (withAmount) columns.push(search.createColumn({ name: b.amount }));

            const rows = [];
            search.create({ type: b.type, filters: filters, columns: columns }).run().each((res) => {
                rows.push({
                    id: res.id,
                    trandate: res.getValue('trandate'),
                    seq: res.getValue('linesequencenumber'),
                    original: res.getValue(b.original),
                    transfers: res.getValue(b.transfers),
                    current: res.getValue(b.current),
                    amount: withAmount ? res.getValue(b.amount) : ''
                });
                return rows.length < 50;
            });
            return rows;
        }

        let rows;
        try {
            rows = runSearch(true);
        } catch (e1) {
            log.audit('findBudget', 'Search with amount column failed (' + e1.message + '); retrying without it.');
            try {
                rows = runSearch(false);
            } catch (e2) {
                log.error('findBudget search failed', e2.message);
                return null;
            }
        }

        if (rows.length === 0) {
            console.log('[BTJ findBudget] no active budget line found');
            log.debug('findBudget', 'no active budget line found');
            return null;
        }
        if (rows.length > 1) {
            log.audit('findBudget', `${rows.length} active budget lines matched; using the latest transaction date. Candidates: ` +
                JSON.stringify(rows.slice(0, 10).map(r => ({ txn: r.id, trandate: r.trandate, seq: r.seq }))));
        }

        const r = rows[0];
        console.log('[BTJ findBudget] raw row', JSON.stringify(r));
        log.debug('findBudget raw row', JSON.stringify(r));

        // Blank columns mean the budget has not been backfilled yet: fall back to the line amount.
        const lineAmount = Math.abs(parseFloat(r.amount || 0)) || 0;
        const original = isBlank(r.original) ? lineAmount : parseFloat(r.original);
        const transfers = isBlank(r.transfers) ? 0 : parseFloat(r.transfers);
        const current = isBlank(r.current) ? original + transfers : parseFloat(r.current);

        const result = {
            id: r.id,                                  // budget transaction internal ID
            lineKey: r.seq,                            // line sequence number (a hint; posting verifies the line)
            ref: r.id + '|' + r.seq,
            original: original,
            transfers: transfers,
            current: current,
            available: current                         // baseline; pending transfers not yet deducted
        };
        log.debug('findBudget result', JSON.stringify(result));
        return result;
    }

    /**
     * Finds the index of the budget line on a loaded budget transaction.
     * Tries the sequence-number hint first (1-based, then 0-based), but ONLY accepts a line whose
     * department and account match. Otherwise falls back to the one line matching department + account.
     * Returns -1 when none match; throws when several match and the hint does not settle it.
     */
    function locateBudgetLine(rec, hintSeq, department, account) {
        const b = lib.loadConfig().budgetRecord;
        const sublistId = b.lineSublist;
        const count = rec.getLineCount({ sublistId: sublistId });
        const get = (fieldId, i) => rec.getSublistValue({ sublistId: sublistId, fieldId: fieldId, line: i });
        const matches = (i) => String(get(b.department, i)) === String(department) &&
            String(get(b.account, i)) === String(account);

        const seq = parseInt(hintSeq, 10);
        if (!isNaN(seq)) {
            const candidates = [seq - 1, seq];
            for (let c = 0; c < candidates.length; c++) {
                const i = candidates[c];
                if (i >= 0 && i < count && matches(i)) return i;
            }
        }

        const all = [];
        for (let i = 0; i < count; i++) {
            if (matches(i)) all.push(i);
        }
        if (all.length === 1) return all[0];
        if (all.length === 0) return -1;
        throw new Error(`More than one budget line matches department ${department} / account ${account}; cannot choose safely.`);
    }

    /**
     * Acquires lock in N/cache
     */
    function acquireLock(recordId) {
        const cache = require('N/cache');
        const config = lib.loadConfig();
        const myCache = cache.getCache({ name: config.lockCacheName, scope: cache.Scope.PROTECTED });
        const key = 'LOCK_' + recordId;
        const existing = myCache.get({ key: key });
        if (existing) {
            return false;
        }
        myCache.put({
            key: key,
            value: 'LOCKED',
            ttl: config.lockSeconds || 300
        });
        return true;
    }

    /**
     * Releases lock in N/cache
     */
    function releaseLock(recordId) {
        const cache = require('N/cache');
        const config = lib.loadConfig();
        const myCache = cache.getCache({ name: config.lockCacheName, scope: cache.Scope.PROTECTED });
        myCache.remove({ key: 'LOCK_' + recordId });
    }

    return {
        findBudget,
        resolveFiscalYear,
        locateBudgetLine,
        acquireLock,
        releaseLock
    };
});
