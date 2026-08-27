import { useCallback } from 'react';
import { Budget, Transaction, TransactionType } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useBudgetStore } from '../stores/budgetStore';
import { writePlanForMonth, toMonthYear } from '@lantern/shared/utils';
import { useUIStore } from '../stores/uiStore';
import { useToastStore } from '../stores/toastStore';
import { saveUserBudget, saveBudgetTransaction, deleteBudgetTransaction, fetchBudgetTransactions } from '../services/supabase';
import { saveBudgetExtras } from '../services/budgetExtrasSync';
import {
  fetchBudgetWalletData,
  claimUnderBudgetAwardApi,
  runRecurring,
} from '../services/budgetApi';
import { v4 as uuidv4 } from 'uuid';
import { AppMode } from '../types';

export function useBudgetHandlers() {
    const { currentUser } = useAuthStore();
    const {
      budget,
      setBudget,
      transactions,
      setTransactions,
      markTransactionPending,
      markTransactionSynced,
      reconcileTransactions,
      savingsGoals,
      expenseSplits,
      walletBalance,
      setWalletBalance,
      setSavingsGoals,
      setExpenseSplits,
    } = useBudgetStore();
    const { setAppMode, closeModal } = useUIStore();

    const handleNavigateToBudgetTracker = useCallback(() => {
        // Sidebar expand/collapse is user-controlled. Do not auto-collapse
        // when opening Budget (it used to force-collapse for full-width content).
        setAppMode(AppMode.BUDGET_TRACKER);
    }, [setAppMode]);

    const handleSetBudget = useCallback((input: Budget | number) => {
        if (!currentUser) return;
        // LOCAL month — transactions are keyed by local date, so a UTC month here
        // would drift a day at each month boundary in WAT (UTC+1).
        const currentMonth = toMonthYear(new Date());
        const newBudget: Budget =
            typeof input === 'number'
                ? {
                    monthlyLimit: input,
                    monthYear: currentMonth,
                    userId: currentUser.id,
                    categoryBudgets: budget?.categoryBudgets,
                    // A bare amount must not silently wipe the plan.
                    plannedIncome: budget?.plannedIncome,
                    plannedSavings: budget?.plannedSavings,
                }
                : {
                    ...input,
                    monthYear: input.monthYear || currentMonth,
                    userId: currentUser.id,
                };

        setBudget(newBudget);
        localStorage.setItem('monthlyBudget', JSON.stringify(newBudget));

        // Record the plan against its month, so history can recover it later.
        const written = writePlanForMonth(
            { plansByMonth: useBudgetStore.getState().plansByMonth },
            newBudget.monthYear,
            {
                plannedExpenses: newBudget.categoryBudgets,
                plannedIncome: newBudget.plannedIncome,
                plannedSavings: newBudget.plannedSavings,
            },
            currentMonth
        );
        useBudgetStore.getState().setPlansByMonth(written.plansByMonth ?? {});

        saveUserBudget(currentUser.id, {
            monthlyLimit: newBudget.monthlyLimit,
            monthYear: newBudget.monthYear,
        }).then(() => {
            console.log('[Budget Sync] Budget saved to cloud');
        }).catch(error => {
            console.error('[Budget Sync] Failed to save budget to cloud:', error);
        });

        saveBudgetExtras(currentUser.id, {
            savingsGoals,
            expenseSplits,
            categoryBudgets: newBudget.categoryBudgets,
            plannedIncome: newBudget.plannedIncome,
            plannedSavings: newBudget.plannedSavings,
            plansByMonth: written.plansByMonth ?? {},
        }).catch(error => {
            console.error('[Budget Sync] Failed to save category budgets:', error);
        });

        closeModal('setBudget');
        closeModal('setMonthlyPlan');
    }, [currentUser, budget?.categoryBudgets, setBudget, closeModal, savingsGoals, expenseSplits]);

    const handleAddTransaction = useCallback((transaction: Omit<Transaction, 'id' | 'userId'>) => {
        if (!currentUser) return;
        const newTransaction: Transaction = {
            ...transaction,
            id: uuidv4(),
            userId: currentUser.id,
        };
        const updatedTransactions = [...transactions, newTransaction].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setTransactions(updatedTransactions);
        // Mark unsynced until the cloud save confirms — a server refetch reconciles
        // against this set and will not drop a row whose save failed.
        markTransactionPending(newTransaction.id);
        const typeMap: Record<string, 'income' | 'expense' | 'investment'> = {
            'INCOME': 'income',
            'EXPENSE': 'expense',
            'INVESTMENT': 'investment'
        };
        saveBudgetTransaction(currentUser.id, {
            id: newTransaction.id,
            type: typeMap[newTransaction.type] || 'expense',
            amount: newTransaction.amount,
            category: newTransaction.category,
            description: newTransaction.description,
            date: newTransaction.date
        }).then(() => {
            markTransactionSynced(newTransaction.id);
        }).catch(error => {
            console.error('[Transactions Sync] Failed to save transaction to cloud:', error);
            // Leave it pending (kept across refetch + reload) and tell the user,
            // instead of losing the entry silently on the next refresh.
            useToastStore.getState().showToast(
                "Couldn't save that to the cloud — it's kept on this device and will retry.",
                'error'
            );
        });

        if (newTransaction.type === TransactionType.EXPENSE && budget?.categoryBudgets) {
            const limit = budget.categoryBudgets[newTransaction.category];
            if (limit && limit > 0) {
                const month = newTransaction.date.slice(0, 7);
                const spent = [...transactions, newTransaction]
                    .filter(
                        (t) =>
                            t.type === TransactionType.EXPENSE &&
                            t.category === newTransaction.category &&
                            t.date.startsWith(month)
                    )
                    .reduce((sum, t) => sum + t.amount, 0);
                if (spent > limit) {
                    console.warn('[Budget] Category overspend', {
                        category: newTransaction.category,
                        spent,
                        limit,
                    });
                    // In-app toast, not a blocking window.alert — the alert was
                    // unthemed, ignored dark mode, and interrupted rapid entry.
                    useToastStore.getState().showToast(
                        `Over budget for this category — spent ₦${spent.toLocaleString('en-NG')} of ₦${limit.toLocaleString('en-NG')}.`,
                        'error'
                    );
                }
            }
        }
        // The add-expense / add-income sheets manage their own close now (so
        // "Add another" can keep them open for rapid entry) — don't force-close here.
    }, [currentUser, transactions, setTransactions, markTransactionPending, markTransactionSynced, budget?.categoryBudgets]);

    const handleDeleteTransaction = useCallback((transactionId: string) => {
        const updatedTransactions = transactions.filter(t => t.id !== transactionId);
        setTransactions(updatedTransactions);
        // Drop it from the pending set too, so a delete can't leave a dangling id.
        markTransactionSynced(transactionId);
        deleteBudgetTransaction(transactionId).then(() => {
            console.log('[Transactions Sync] Transaction deleted from cloud');
        }).catch(error => {
            console.error('[Transactions Sync] Failed to delete transaction from cloud:', error);
        });
    }, [transactions, setTransactions, markTransactionSynced]);

    const refreshBudgetTransactions = useCallback(async (userId?: string) => {
        const uid = userId || currentUser?.id;
        if (!uid) return;
        try {
            const rows = await fetchBudgetTransactions(uid);
            const mapped: Transaction[] = rows.map((t) => ({
                id: t.id,
                userId: uid,
                type: t.type.toUpperCase() as TransactionType,
                amount: t.amount,
                category: t.category || '',
                description: t.description || '',
                date: typeof t.date === 'string' ? t.date.split('T')[0] : t.date,
            }));
            // Reconcile, don't clobber: rows whose save is still pending are kept
            // (previously this overwrite silently wiped a failed/in-flight save).
            reconcileTransactions(mapped);

            // Best-effort retry: re-save any row the server still doesn't have.
            const serverIds = new Set(mapped.map((t) => t.id));
            const store = useBudgetStore.getState();
            const typeMap: Record<string, 'income' | 'expense' | 'investment'> = {
                INCOME: 'income', EXPENSE: 'expense', INVESTMENT: 'investment',
            };
            for (const id of store.pendingTransactionIds) {
                if (serverIds.has(id)) continue;
                const tx = store.transactions.find((t) => t.id === id);
                if (!tx) continue;
                saveBudgetTransaction(uid, {
                    id: tx.id,
                    type: typeMap[tx.type] || 'expense',
                    amount: tx.amount,
                    category: tx.category,
                    description: tx.description,
                    date: tx.date,
                })
                    .then(() => useBudgetStore.getState().markTransactionSynced(tx.id))
                    .catch(() => { /* stays pending; retried next refresh */ });
            }
        } catch (error) {
            console.error('[Budget Sync] Failed to refresh transactions from cloud:', error);
        }
    }, [currentUser?.id, reconcileTransactions]);

    const refreshBudgetWallet = useCallback(async () => {
        if (!currentUser?.id) return;
        try {
            const data = await fetchBudgetWalletData();
            setWalletBalance(data.walletBalance);
            if (Array.isArray(data.savingsGoals)) setSavingsGoals(data.savingsGoals);
            if (Array.isArray(data.expenseSplits)) setExpenseSplits(data.expenseSplits);
            if (data.categoryBudgets && typeof data.categoryBudgets === 'object') {
                const current = useBudgetStore.getState().budget;
                // Merge, don't replace: the wallet payload only carries
                // categoryBudgets, so a plain rebuild would drop plannedIncome /
                // plannedSavings and make the "every naira has a job" panel
                // vanish on every window refocus (and a later save would then
                // persist the wiped plan).
                setBudget({
                    ...current,
                    monthlyLimit: current?.monthlyLimit ?? 0,
                    monthYear: current?.monthYear ?? toMonthYear(new Date()),
                    userId: currentUser.id,
                    categoryBudgets: data.categoryBudgets,
                });
            }
        } catch (error) {
            console.error('[Budget Sync] Failed to refresh wallet:', error);
        }
    }, [currentUser?.id, setWalletBalance, setSavingsGoals, setExpenseSplits, setBudget]);

    // Post any due recurring rules, then refresh so they appear. Idempotent on
    // the server (a repeat run posts nothing), so calling it on every open is safe.
    const materializeRecurring = useCallback(async () => {
        if (!currentUser?.id) return;
        try {
            const { posted } = await runRecurring();
            if (posted > 0) await refreshBudgetTransactions(currentUser.id);
        } catch (error) {
            console.error('[Budget] Failed to run recurring transactions:', error);
        }
    }, [currentUser?.id, refreshBudgetTransactions]);

    const claimUnderBudgetAward = useCallback(async () => {
        if (!currentUser?.id) return;
        try {
            const result = await claimUnderBudgetAwardApi();
            if (typeof result.walletBalance === 'number') {
                setWalletBalance(result.walletBalance);
            }
            return result;
        } catch (error) {
            console.error('[Budget Sync] Under-budget award failed:', error);
            return null;
        }
    }, [currentUser?.id, setWalletBalance]);

    return {
        handleNavigateToBudgetTracker,
        handleSetBudget,
        handleAddTransaction,
        handleDeleteTransaction,
        refreshBudgetTransactions,
        refreshBudgetWallet,
        materializeRecurring,
        claimUnderBudgetAward,
    };
}
