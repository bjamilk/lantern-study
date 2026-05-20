import { useCallback } from 'react';
import { Budget, Transaction, TransactionType } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useBudgetStore } from '../stores/budgetStore';
import { useUIStore } from '../stores/uiStore';
import { saveUserBudget, saveBudgetTransaction, deleteBudgetTransaction } from '../services/supabase';
import { v4 as uuidv4 } from 'uuid';
import { AppMode } from '../types';

export function useBudgetHandlers() {
    const { currentUser } = useAuthStore();
    const { budget, setBudget, transactions, setTransactions } = useBudgetStore();
    const { setAppMode, setSidebarExpanded, openModal, closeModal } = useUIStore();

    const handleNavigateToBudgetTracker = useCallback(() => {
        setAppMode(AppMode.BUDGET_TRACKER);
        setSidebarExpanded(false);
    }, [setAppMode, setSidebarExpanded]);

    const handleSetBudget = useCallback((amount: number) => {
        if (!currentUser) return;
        const currentMonth = new Date().toISOString().slice(0, 7);
        const newBudget: Budget = {
            monthlyLimit: amount,
            monthYear: currentMonth,
            userId: currentUser.id,
        };
        setBudget(newBudget);
        saveUserBudget(currentUser.id, {
            monthlyLimit: amount,
            monthYear: currentMonth
        }).then(() => {
            console.log('[Budget Sync] Budget saved to cloud');
        }).catch(error => {
            console.error('[Budget Sync] Failed to save budget to cloud:', error);
        });
        closeModal('setBudget');
    }, [currentUser, setBudget, closeModal]);

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
        closeModal('addExpense');
        closeModal('addIncome');
    }, [currentUser, transactions, setTransactions, closeModal]);

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

    return {
        handleNavigateToBudgetTracker,
        handleSetBudget,
        handleAddTransaction,
        handleDeleteTransaction,
    };
}
