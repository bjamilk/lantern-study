// ===========================================
// Lantern Study Mobile - Budget Tracker Screen
// ===========================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { PieChart } from 'react-native-gifted-charts';
import {
  useBudgetStore,
  formatCurrency,
  getProgressBarColor,
  type Transaction,
} from '../../stores/budgetStore';
import { useTheme } from '../../theme';

const { width } = Dimensions.get('window');

export default function BudgetScreen() {
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const { colors } = useTheme();

  const {
    transactions,
    budget,
    isLoading,
    monthlyExpenses,
    monthlyIncome,
    budgetProgress,
    expensesByCategory,
    fetchTransactions,
    fetchBudget,
    deleteTransaction,
  } = useBudgetStore();

  useEffect(() => {
    fetchTransactions('demo-user');
    fetchBudget('demo-user');
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      fetchTransactions('demo-user'),
      fetchBudget('demo-user'),
    ]);
    setRefreshing(false);
  }, [fetchTransactions, fetchBudget]);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthlyTransactions = useMemo(() => 
    transactions.filter(t => t.date.startsWith(currentMonth))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [transactions, currentMonth]
  );

  const netAmount = monthlyIncome - monthlyExpenses;

  const handleDeleteTransaction = useCallback((transaction: Transaction) => {
    Alert.alert(
      'Delete Transaction',
      `Are you sure you want to delete "${transaction.description}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteTransaction(transaction.id),
        },
      ]
    );
  }, [deleteTransaction]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-NG', {
      month: 'short',
      day: 'numeric',
    });
  };

  // Prepare pie chart data
  const pieData = useMemo(() => {
    if (expensesByCategory.length === 0) return [];
    return expensesByCategory.map(cat => ({
      value: cat.amount,
      color: cat.color,
      text: cat.name,
    }));
  }, [expensesByCategory]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Budget Tracker</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Manage your finances</Text>
        </View>
        <TouchableOpacity
          style={[styles.settingsButton, { backgroundColor: colors.card }]}
          onPress={() => navigation.navigate('Budget', { screen: 'SetBudget' })}
        >
          <Ionicons name="settings-outline" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
            colors={['#6366f1']}
          />
        }
      >
        {/* Budget Progress Card */}
        <View style={[styles.budgetCard, { backgroundColor: colors.card }]}>
          <View style={styles.budgetHeader}>
            <Text style={[styles.budgetTitle, { color: colors.text }]}>This Month's Budget</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Budget', { screen: 'SetBudget' })}
            >
              <Text style={styles.editBudgetText}>
                {budget ? 'Edit' : 'Set Budget'}
              </Text>
            </TouchableOpacity>
          </View>

          {budget ? (
            <>
              <View style={styles.budgetAmounts}>
                <Text style={[styles.spentAmount, { color: colors.text }]}>{formatCurrency(monthlyExpenses)}</Text>
                <Text style={[styles.totalAmount, { color: colors.textSecondary }]}>/ {formatCurrency(budget.targetAmount)}</Text>
              </View>

              <View style={styles.progressContainer}>
                <View style={[styles.progressBackground, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.progressBar,
                      {
                        width: `${Math.min(budgetProgress, 100)}%`,
                        backgroundColor: getProgressBarColor(budgetProgress),
                      },
                    ]}
                  />
                </View>
              </View>

              <Text style={[styles.budgetStatus, { color: colors.textSecondary }]}>
                {budgetProgress <= 100
                  ? `${formatCurrency(budget.targetAmount - monthlyExpenses)} left to spend`
                  : `${formatCurrency(monthlyExpenses - budget.targetAmount)} over budget`}
              </Text>
            </>
          ) : (
            <View style={[styles.noBudgetContainer, { borderColor: colors.border }]}>
              <Ionicons name="wallet-outline" size={40} color={colors.textSecondary} />
              <Text style={[styles.noBudgetText, { color: colors.textSecondary }]}>No budget set for this month</Text>
              <TouchableOpacity
                style={styles.setBudgetButton}
                onPress={() => navigation.navigate('Budget', { screen: 'SetBudget' })}
              >
                <Text style={styles.setBudgetButtonText}>Set a monthly budget</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Income/Expense/Net Summary */}
          <View style={[styles.summaryRow, { borderTopColor: colors.border }]}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Income</Text>
              <Text style={[styles.summaryValue, { color: '#22c55e' }]}>
                {formatCurrency(monthlyIncome)}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Expenses</Text>
              <Text style={[styles.summaryValue, { color: '#ef4444' }]}>
                {formatCurrency(monthlyExpenses)}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Net</Text>
              <Text
                style={[
                  styles.summaryValue,
                  { color: netAmount >= 0 ? '#22c55e' : '#ef4444' },
                ]}
              >
                {formatCurrency(netAmount)}
              </Text>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, styles.expenseButton]}
            onPress={() => navigation.navigate('Budget', { screen: 'AddExpense' })}
          >
            <Ionicons name="arrow-down" size={24} color="#ffffff" />
            <Text style={styles.actionButtonText}>Add Expense</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.incomeButton]}
            onPress={() => navigation.navigate('Budget', { screen: 'AddIncome' })}
          >
            <Ionicons name="arrow-up" size={24} color="#ffffff" />
            <Text style={styles.actionButtonText}>Add Income</Text>
          </TouchableOpacity>
        </View>

        {/* Spending by Category */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Spending by Category</Text>
          
          {pieData.length > 0 ? (
            <View style={styles.chartContainer}>
              <PieChart
                data={pieData}
                donut
                radius={80}
                innerRadius={50}
                innerCircleColor={colors.card}
                centerLabelComponent={() => (
                  <View style={styles.chartCenter}>
                    <Text style={[styles.chartCenterAmount, { color: colors.text }]}>
                      {formatCurrency(monthlyExpenses)}
                    </Text>
                    <Text style={[styles.chartCenterLabel, { color: colors.textSecondary }]}>Total</Text>
                  </View>
                )}
              />
              <View style={styles.legendContainer}>
                {expensesByCategory.slice(0, 5).map((cat, index) => (
                  <View key={cat.name} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: cat.color }]} />
                    <Text style={[styles.legendText, { color: colors.text }]} numberOfLines={1}>
                      {cat.name}
                    </Text>
                    <Text style={[styles.legendAmount, { color: colors.textSecondary }]}>{formatCurrency(cat.amount)}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.emptyChart}>
              <Ionicons name="pie-chart-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyChartText, { color: colors.textSecondary }]}>No expenses logged this month</Text>
            </View>
          )}
        </View>

        {/* Recent Transactions */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Transactions</Text>

          {monthlyTransactions.length > 0 ? (
            <View style={styles.transactionsList}>
              {monthlyTransactions.slice(0, 10).map(transaction => (
                <View key={transaction.id} style={[styles.transactionItem, { borderBottomColor: colors.border }]}>
                  <View
                    style={[
                      styles.transactionIcon,
                      transaction.type === 'INCOME'
                        ? styles.incomeIcon
                        : styles.expenseIcon,
                    ]}
                  >
                    <Ionicons
                      name={transaction.type === 'INCOME' ? 'arrow-up' : 'arrow-down'}
                      size={18}
                      color={transaction.type === 'INCOME' ? '#22c55e' : '#ef4444'}
                    />
                  </View>

                  <View style={styles.transactionDetails}>
                    <Text style={[styles.transactionDescription, { color: colors.text }]} numberOfLines={1}>
                      {transaction.description}
                    </Text>
                    <Text style={[styles.transactionMeta, { color: colors.textSecondary }]}>
                      {transaction.category} • {formatDate(transaction.date)}
                    </Text>
                  </View>

                  <View style={styles.transactionRight}>
                    <Text
                      style={[
                        styles.transactionAmount,
                        transaction.type === 'INCOME'
                          ? styles.incomeAmount
                          : styles.expenseAmount,
                      ]}
                    >
                      {transaction.type === 'INCOME' ? '+' : '-'}
                      {formatCurrency(transaction.amount)}
                    </Text>
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDeleteTransaction(transaction)}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyTransactions}>
              <Ionicons name="receipt-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyTransactionsText, { color: colors.textSecondary }]}>
                No transactions this month
              </Text>
            </View>
          )}
        </View>

        {/* Bottom spacing */}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 2,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  budgetCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  budgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  budgetTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  editBudgetText: {
    fontSize: 13,
    color: '#6366f1',
    fontWeight: '600',
  },
  budgetAmounts: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  spentAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  totalAmount: {
    fontSize: 16,
    color: '#9ca3af',
  },
  progressContainer: {
    marginTop: 12,
  },
  progressBackground: {
    height: 12,
    backgroundColor: '#334155',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 6,
  },
  budgetStatus: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 8,
  },
  noBudgetContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#334155',
    borderRadius: 12,
  },
  noBudgetText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 8,
  },
  setBudgetButton: {
    marginTop: 12,
  },
  setBudgetButtonText: {
    fontSize: 14,
    color: '#6366f1',
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: '#334155',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  expenseButton: {
    backgroundColor: '#ef4444',
  },
  incomeButton: {
    backgroundColor: '#22c55e',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  sectionCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 16,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chartCenter: {
    alignItems: 'center',
  },
  chartCenterAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  chartCenterLabel: {
    fontSize: 10,
    color: '#9ca3af',
  },
  legendContainer: {
    flex: 1,
    marginLeft: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  legendText: {
    flex: 1,
    fontSize: 12,
    color: '#d1d5db',
  },
  legendAmount: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
  },
  emptyChart: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyChartText: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 8,
  },
  transactionsList: {
    gap: 8,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  incomeIcon: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  expenseIcon: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  transactionDetails: {
    flex: 1,
  },
  transactionDescription: {
    fontSize: 14,
    fontWeight: '500',
    color: '#ffffff',
    marginBottom: 2,
  },
  transactionMeta: {
    fontSize: 12,
    color: '#6b7280',
  },
  transactionRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: '600',
  },
  incomeAmount: {
    color: '#22c55e',
  },
  expenseAmount: {
    color: '#ef4444',
  },
  deleteButton: {
    padding: 4,
  },
  emptyTransactions: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyTransactionsText: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 8,
  },
});
