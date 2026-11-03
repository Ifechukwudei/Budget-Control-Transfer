/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 *
 * amt_btj_line_cs.js - Client script for the Budget Transfer Line record (customrecord_amt_btj_line).
 * Looks up the active budget line when Department/Account change, fills the read-only budget
 * figures, and enforces R02 / R03 / R05 on save.
 */
define(['./amt_btj_lib', './amt_btj_budget', 'N/search', 'N/ui/dialog'], (lib, budgetLib, search, dialog) => {

    const F = {
        parent: 'custrecord_amt_btjl_parent',
        department: 'custrecord_amt_btjl_department',
        account: 'custrecord_amt_btjl_account',
        project: 'custrecord_amt_btjl_project',
        increase: 'custrecord_amt_btjl_increase',
        decrease: 'custrecord_amt_btjl_decrease',
        original: 'custrecord_amt_btjl_original',
        current: 'custrecord_amt_btjl_current',
        available: 'custrecord_amt_btjl_available',
        budgetRef: 'custrecord_amt_btjl_budget_ref',
        lineKey: 'custrecord_amt_btjl_line_key'
    };

    let parentCache = { id: null, subsidiary: null, year: null };

    function pageInit() {
        // Client scripts cannot load N/file, so use the inlined config.
        lib.setConfig(lib.getStaticConfig());
    }

    function getParentContext(rec) {
        const parentId = rec.getValue({ fieldId: F.parent });
        if (!parentId) return null;
        if (parentCache.id === String(parentId)) return parentCache;

        const p = search.lookupFields({
            type: 'customrecord_amt_btj',
            id: parentId,
            columns: ['custrecord_amt_btj_subsidiary', 'custrecord_amt_btj_year']
        });
        parentCache = {
            id: String(parentId),
            subsidiary: p.custrecord_amt_btj_subsidiary && p.custrecord_amt_btj_subsidiary[0] ? p.custrecord_amt_btj_subsidiary[0].value : null,
            year: p.custrecord_amt_btj_year && p.custrecord_amt_btj_year[0] ? p.custrecord_amt_btj_year[0].value : null
        };
        return parentCache;
    }

    function setDerived(rec, found) {
        const vals = found || { original: '', current: '', available: '', id: '', lineKey: '' };
        rec.setValue({ fieldId: F.original, value: vals.original, ignoreFieldChange: true });
        rec.setValue({ fieldId: F.current, value: vals.current, ignoreFieldChange: true });
        rec.setValue({ fieldId: F.available, value: vals.available, ignoreFieldChange: true });
        rec.setValue({ fieldId: F.budgetRef, value: vals.id, ignoreFieldChange: true });
        rec.setValue({ fieldId: F.lineKey, value: vals.lineKey, ignoreFieldChange: true });
    }

    function refreshBudget(rec) {
        const dept = rec.getValue({ fieldId: F.department });
        const acct = rec.getValue({ fieldId: F.account });
        if (!dept || !acct) {
            setDerived(rec, null);
            return;
        }

        const ctx = getParentContext(rec);
        if (!ctx || !ctx.subsidiary || !ctx.year) {
            dialog.alert({
                title: 'Missing Transfer Details',
                message: 'Subsidiary and Budget Year must be set on the Budget Transfer before adding lines.'
            });
            setDerived(rec, null);
            return;
        }

        const found = budgetLib.findBudget({
            subsidiary: ctx.subsidiary,
            year: ctx.year,
            department: dept,
            account: acct,
            project: rec.getValue({ fieldId: F.project })
        });

        if (found) {
            setDerived(rec, found);
        } else {
            setDerived(rec, null);
            dialog.alert({
                title: 'No Active Budget',
                message: 'Rule R05 Violation: No active budget record found for this Department and Account combination in the selected budget year.'
            });
        }
    }

    function fieldChanged(context) {
        const rec = context.currentRecord;
        const fieldId = context.fieldId;

        if (fieldId === F.department || fieldId === F.account) {
            refreshBudget(rec);
        } else if (fieldId === F.increase) {
            if (parseFloat(rec.getValue({ fieldId: F.increase })) > 0) {
                rec.setValue({ fieldId: F.decrease, value: '', ignoreFieldChange: true });
            }
        } else if (fieldId === F.decrease) {
            if (parseFloat(rec.getValue({ fieldId: F.decrease })) > 0) {
                rec.setValue({ fieldId: F.increase, value: '', ignoreFieldChange: true });
            }
        }
    }

    function saveRecord(context) {
        const rec = context.currentRecord;
        const inc = parseFloat(rec.getValue({ fieldId: F.increase }) || 0);
        const dec = parseFloat(rec.getValue({ fieldId: F.decrease }) || 0);
        const bRef = rec.getValue({ fieldId: F.budgetRef });
        const avail = parseFloat(rec.getValue({ fieldId: F.available }) || 0);

        // R03
        if (inc > 0 && dec > 0) {
            dialog.alert({ title: 'Validation Error', message: 'Rule R03: Enter an Increase or a Decrease, not both.' });
            return false;
        }
        if (inc <= 0 && dec <= 0) {
            dialog.alert({ title: 'Validation Error', message: 'Rule R03: Enter a positive Increase or Decrease.' });
            return false;
        }
        // R05
        if (!bRef) {
            dialog.alert({ title: 'Validation Error', message: 'Rule R05: No active budget is matched for this Department and Account.' });
            return false;
        }
        // R02
        if (dec > 0 && dec > avail) {
            dialog.alert({ title: 'Validation Error', message: `Rule R02: Decrease (${dec}) exceeds Funds Available (${avail}).` });
            return false;
        }
        return true;
    }

    return {
        pageInit,
        fieldChanged,
        saveRecord
    };
});
