/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * amt_btj_budget.js - Active Custom Budget lookups, funds available calculation, locks, and updates
 */
/**
 * NOTE: N/cache and N/record are server-side-only modules. They must NOT
 * appear in the define() array because this module is also loaded by the
 * Client Script. They are lazy-loaded via require() inside the functions
 * that actually need them (acquireLock / releaseLock), which are never
 * called from the client-side code path.
 */
define(['N/search', 'N/log', './amt_btj_lib'], (search, log, lib) => {

    /**
     * Looks up active budget record for a given combination
     */
    function findBudget(params) {
        const config = lib.loadConfig();
        const bConf = config.budgetRecord;

        const filters = [
            [bConf.subsidiary, 'anyof', params.subsidiary],
            'AND',
            [bConf.department, 'anyof', params.department],
            'AND',
            [bConf.account, 'anyof', params.account]
        ];

        if (bConf.year && params.year) {
            filters.push('AND');
            filters.push([bConf.year, 'is', params.year]);
        }

        if (config.useProject && params.project) {
            filters.push('AND');
            filters.push([bConf.project, 'anyof', params.project]);
        }

        const columns = [
            'internalid',
            bConf.original,
            bConf.transfers,
            bConf.current
        ];

        let result = null;
        try {
            const bSearch = search.create({
                type: bConf.type,
                filters: filters,
                columns: columns
            });

            bSearch.run().each((res) => {
                const orig = parseFloat(res.getValue(bConf.original) || 0);
                const transfers = parseFloat(res.getValue(bConf.transfers) || 0);
                let current = parseFloat(res.getValue(bConf.current) || (orig + transfers));

                result = {
                    id: res.id,
                    original: orig,
                    transfers: transfers,
                    current: current,
                    available: current // Baseline available before consumption
                };
                return false; // first match
            });
        } catch (e) {
            log.error('findBudget Error', e.message);
        }

        return result;
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
        acquireLock,
        releaseLock
    };
});
