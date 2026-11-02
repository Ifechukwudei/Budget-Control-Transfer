/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * amt_btj_lib.js - Shared configuration, validation rules (R01-R09), and helpers
 *
 * NOTE: N/file is a server-side-only module and must NOT be required() at the
 * define() level because this library is also loaded by the Client Script.
 * Instead, N/file is loaded lazily via require() inside loadConfig() so that
 * the client-side execution path (which uses the inlined static config) never
 * triggers the unavailable module.
 */
define(['N/log'], (log) => {
    let cachedConfig = null;

    /**
     * Static fallback config – mirrors amt_btj_config.json.
     * Used by the Client Script context where N/file is unavailable.
     * Keep in sync with amt_btj_config.json whenever values change.
     */
    const STATIC_CONFIG = {
        budgetRecord: {
            type: 'customtransaction_bm_budget_transaction',
            subsidiary: 'subsidiary',
            department: 'department',
            account: 'account',
            project: 'custcol_bm_customer',
            year: 'custbody_bm_financial_year',
            inactive: 'isinactive',
            original: 'custcol_amt_bud_original',
            transfers: 'custcol_amt_bud_transfers',
            current: 'custcol_amt_bud_current'
        },
        useProject: false,
        uploadEnabled: true,
        uploadMaxRows: 500,
        lineSublist: 'recmachcustrecord_amt_btjl_parent',
        status: {
            draft: 'val_amt_btj_draft',
            pending: 'val_amt_btj_pending',
            approved: 'val_amt_btj_approved',
            posted: 'val_amt_btj_posted',
            rejected: 'val_amt_btj_rejected',
            error: 'val_amt_btj_error',
            reversed: 'val_amt_btj_reversed'
        },
        budgetControlledAccounts: '',
        lockCacheName: 'AMT_BTJ_LOCK',
        lockSeconds: 300
    };

    /**
     * Loads and parses amt_btj_config.json from the File Cabinet (server side).
     * Falls back to STATIC_CONFIG when N/file is unavailable (client context).
     */
    function loadConfig() {
        if (cachedConfig) return cachedConfig;
        try {
            // require() is safe here: it is only invoked on server-side script
            // types (UE, MR, WFA, Suitelet) where N/file is available.
            // On the client side this branch is never reached because the
            // client script pre-sets cachedConfig via setConfig() below.
            const file = require('N/file');
            const configFile = file.load({
                id: 'SuiteScripts/Budget_Transfer_Journal/amt_btj_config.json'
            });
            cachedConfig = JSON.parse(configFile.getContents());
            return cachedConfig;
        } catch (e) {
            // N/file not available (client context) — use static config.
            log.debug && log.debug('amt_btj_lib.loadConfig', 'N/file unavailable; using static config. Detail: ' + e.message);
            cachedConfig = STATIC_CONFIG;
            return cachedConfig;
        }
    }

    /**
     * Allows the Client Script to explicitly inject the config without touching
     * N/file, keeping the module client-safe.
     */
    function setConfig(cfg) {
        cachedConfig = cfg;
    }

    /**
     * Calculates total increase, total decrease, and difference for a lines array
     */
    function calculateTotals(lines) {
        let totalInc = 0;
        let totalDec = 0;
        if (lines && lines.length > 0) {
            for (let i = 0; i < lines.length; i++) {
                totalInc += parseFloat(lines[i].increase || 0);
                totalDec += parseFloat(lines[i].decrease || 0);
            }
        }
        totalInc = Math.round(totalInc * 100) / 100;
        totalDec = Math.round(totalDec * 100) / 100;
        const diff = Math.round((totalInc - totalDec) * 100) / 100;
        return { totalInc, totalDec, diff };
    }

    /**
     * Core validation rules (R01 - R09)
     */
    function validateTransfer(header, lines, isSubmit = false) {
        const errors = [];

        // R01: Total increases must equal total decreases
        const totals = calculateTotals(lines);
        if (totals.totalInc <= 0 || totals.totalDec <= 0) {
            errors.push('Transfer must have non-zero amounts.');
        } else if (totals.diff !== 0) {
            errors.push(`Total increases (${totals.totalInc}) must equal total decreases (${totals.totalDec}). Difference: ${totals.diff}`);
        }

        // R04: Budget Year must be present
        if (!header.year) {
            errors.push('Budget Year is mandatory.');
        }

        // R08: Justification mandatory; Supporting Memo mandatory before Submit
        if (!header.justification || header.justification.trim() === '') {
            errors.push('Justification is mandatory.');
        }
        if (isSubmit && !header.file) {
            errors.push('Supporting Memo must be attached before submission (Rule R08).');
        }

        // Line-level checks
        const combinationMap = {};
        for (let idx = 0; idx < lines.length; idx++) {
            const line = lines[idx];
            const lineNum = idx + 1;

            const inc = parseFloat(line.increase || 0);
            const dec = parseFloat(line.decrease || 0);

            // R03: Amount in either increase or decrease, not both, and positive
            if (inc > 0 && dec > 0) {
                errors.push(`Line ${lineNum}: Line cannot have both an Increase and a Decrease.`);
            }
            if (inc <= 0 && dec <= 0) {
                errors.push(`Line ${lineNum}: Must enter either a positive Increase or Decrease.`);
            }

            // R02: Decrease cannot exceed Funds Available
            if (dec > 0) {
                const available = parseFloat(line.available || 0);
                if (dec > available) {
                    errors.push(`Line ${lineNum}: Decrease (${dec}) exceeds Funds Available (${available}) for this combination.`);
                }
            }

            // R05: Active budget record must exist
            if (!line.budgetRef) {
                errors.push(`Line ${lineNum}: No active budget record found for combination.`);
            }

            // R06: Combination appears only once per transfer
            const comboKey = `${line.department}_${line.account}_${line.project || '0'}`;
            if (combinationMap[comboKey]) {
                errors.push(`Line ${lineNum}: Department and Account combination is duplicated on the transfer.`);
            }
            combinationMap[comboKey] = true;
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    return {
        loadConfig,
        setConfig,
        calculateTotals,
        validateTransfer
    };
});
