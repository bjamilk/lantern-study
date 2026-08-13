import { useCallback } from 'react';
import { Budget, Transaction, TransactionType } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useBudgetStore } from '../stores/budgetStore';
import { writePlanForMonth } from '@lantern/shared/utils';
import { useUIStore } from '../stores/uiStore';
import { saveUserBudget, saveBudgetTransaction, deleteBudgetTransaction, fetchBudgetTransactions } from '../services/supabase';
import { saveBudgetExtras } from '../services/budgetExtrasSync';
import {
  fetchBudgetWalletData,
  claimUnderBudgetAwardApi,
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
      savingsGoals,
      expenseSplits,
      walletBalance,
      setWalletBalance,
      setSavingsGoals,
      setExpenseSplits,
    } = useBudgetStore();
    const { setAppMode, setSidebarExpanded, closeModal } = useUIStore();

    const handleNavigateToBudgetTracker = useCallback(() => {
        setAppMode(AppMode.BUDGET_TRACKER);
        setSidebarExpanded(false);
    }, [setAppMode, setSidebarExpanded]);

    const handleSetBudget = useCallback((input: Budget | number) => {
        if (!currentUser) return;
        const currentMonth = new Date().toISOString().slice(0, 7);
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
        localStorage.setItem('budgetTransactions', JSON.stringify(updatedTransactions));
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
            console.log('[Transactions Sync] Transaction saved to cloud');
        }).catch(error => {
            console.error('[Transactions Sync] Failed to save transaction to cloud:', error);
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
                    if (typeof window !== 'undefined') {
                        window.setTimeout(() => {
                            window.alert(
                                `You have exceeded your budget for this category (spent ₦${spent.toLocaleString('en-NG')} of ₦${limit.toLocaleString('en-NG')}).`
                            );
                        }, 0);
                    }
                }
            }
        }

        closeModal('addExpense');
        closeModal('addIncome');
        closeModal('addInvestment');
    }, [currentUser, transactions, setTransactions, closeModal, budget?.categoryBudgets]);

    const handleDeleteTransaction = useCallback((transactionId: string) => {
        const updatedTransactions = transactions.filter(t => t.id !== transactionId);
        setTransactions(updatedTransactions);
        localStorage.setItem('budgetTransactions', JSON.stringify(updatedTransactions));
        deleteBudgetTransaction(transactionId).then(() => {
            console.log('[Transactions Sync] Transaction deleted from cloud');
        }).catch(error => {
            console.error('[Transactions Sync] Failed to delete transaction from cloud:', error);
        });
    }, [transactions, setTransactions]);

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
            setTransactions(mapped);
        } catch (error) {
            console.error('[Budget Sync] Failed to refresh transactions from cloud:', error);
        }
    }, [currentUser?.id, setTransactions]);

    const refreshBudgetWallet = useCallback(async () => {
        if (!currentUser?.id) return;
        try {
            const data = await fetchBudgetWalletData();
            setWalletBalance(data.walletBalance);
            if (Array.isArray(data.savingsGoals)) setSavingsGoals(data.savingsGoals);
            if (Array.isArray(data.expenseSplits)) setExpenseSplits(data.expenseSplits);
            if (data.categoryBudgets && typeof data.categoryBudgets === 'object') {
                const current = useBudgetStore.getState().budget;
                setBudget({
                    monthlyLimit: current?.monthlyLimit ?? 0,
                    monthYear: current?.monthYear ?? new Date().toISOString().slice(0, 7),
                    userId: currentUser.id,
                    categoryBudgets: data.categoryBudgets,
                });
            }
        } catch (error) {
            console.error('[Budget Sync] Failed to refresh wallet:', error);
        }
    }, [currentUser?.id, setWalletBalance, setSavingsGoals, setExpenseSplits, setBudget]);

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
        claimUnderBudgetAward,
    };
}
