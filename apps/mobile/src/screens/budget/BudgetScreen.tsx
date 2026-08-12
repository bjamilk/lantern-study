// ===========================================
import { parseDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
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
  getCategoryLabel,
  type Transaction,
} from '../../stores/budgetStore';
import { useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { FeatureHero } from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import {
  computePeriodPace,
  computeSpendPace,
  isBudgetForMonth,
  normalizeBudgetPlan,
  summarizeBudgetPlan,
} from '@lantern/shared/utils';
import { featureAccents } from '@lantern/shared/design';

const { width } = Dimensions.get('window');

type BudgetTab = 'overview' | 'transactions' | 'goals' | 'insights';
type TxFilter = 'all' | 'income' | 'expense';

const TABS: { key: BudgetTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'overview', label: 'Overview', icon: 'pie-chart-outline' },
  { key: 'transactions', label: 'Transactions', icon: 'receipt-outline' },
  { key: 'goals', label: 'Goals', icon: 'trophy-outline' },
  { key: 'insights', label: 'Insights', icon: 'bulb-outline' },
];

export default function BudgetScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(s => s.user?.id) || '';
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<BudgetTab>('overview');
  const [txFilter, setTxFilter] = useState<TxFilter>('all');
  const { colors } = useTheme();
  const tabBarClearance = useTabBarClearance(24);

  const {
    transactions,
    budget,
    isLoading,
    monthlyExpenses,
    monthlyIncome,
    budgetProgress,
    expensesByCategory,
    savingsGoals,
    expenseSplits,
    walletBalance,
    fetchTransactions,
    fetchBudget,
    loadBudgetExtras,
    deleteTransaction,
  } = useBudgetStore();

  useEffect(() => {
    if (!userId) return;
    fetchTransactions(userId);
    fetchBudget(userId);
    loadBudgetExtras(userId);
  }, [userId, fetchTransactions, fetchBudget, loadBudgetExtras]);

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    await Promise.all([
      fetchTransactions(userId),
      fetchBudget(userId),
      loadBudgetExtras(userId),
    ]);
    setRefreshing(false);
  }, [userId, fetchTransactions, fetchBudget, loadBudgetExtras]);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthlyTransactions = useMemo(() => 
    transactions.filter(t => t.date.startsWith(currentMonth))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [transactions, currentMonth]
  );

  const filteredTransactions = useMemo(() => {
    if (txFilter === 'income') return monthlyTransactions.filter(t => t.type === 'INCOME');
    if (txFilter === 'expense') return monthlyTransactions.filter(t => t.type === 'EXPENSE');
    return monthlyTransactions;
  }, [monthlyTransactions, txFilter]);

  const biggestCategory = expensesByCategory[0];
  const avgDailySpend = monthlyExpenses / Math.max(1, new Date().getDate());
  const projectedMonth = avgDailySpend * 30;

  const netAmount = monthlyIncome - monthlyExpenses;

  // Zero-based view of the month: what is planned, and how far the calendar has
  // run against how much has been spent. Both come from @lantern/shared so the
  // web client shows identical numbers.
  // A budget belongs to the month it was saved for. Last month's cap must not
  // score this month's spending, and last month's plan must not reappear as if
  // it were this month's.
  const activeBudget = useMemo(
    () => (budget && isBudgetForMonth(budget.month, currentMonth) ? budget : null),
    [budget, currentMonth]
  );

  const plan = useMemo(
    () => normalizeBudgetPlan(activeBudget, currentMonth),
    [activeBudget, currentMonth]
  );
  const planSummary = useMemo(() => summarizeBudgetPlan(plan), [plan]);
  const pace = useMemo(() => computePeriodPace(currentMonth, new Date()), [currentMonth]);
  const spendPace = useMemo(
    () => computeSpendPace(monthlyExpenses, planSummary.totalPlannedExpenses, pace),
    [monthlyExpenses, planSummary.totalPlannedExpenses, pace]
  );

  const handleDeleteTransaction = useCallback((transaction: Transaction) => {
    Alert.alert(
      'Delete Transaction',
      `Are you sure you want to delete "${transaction.description}"?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes',
          style: 'destructive',
          onPress: () => deleteTransaction(transaction.id),
        },
      ]
    );
  }, [deleteTransaction]);

  const formatDate = (dateString: string) => {
    return parseDateOnlyLocal(dateString).toLocaleDateString('en-NG', {
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
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2">
        <FeatureHero
          title="Campus Pocket"
          subtitle={new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          accentColor={featureAccents.budget}
          right={
            <TouchableOpacity
              className="p-2 rounded-xl bg-lantern-primary-background min-w-[44px] min-h-[44px] items-center justify-center"
              onPress={() => navigation.navigate('SetBudget')}
            >
              <Ionicons name="settings-outline" size={22} color={featureAccents.budget} />
            </TouchableOpacity>
          }
        >
          <View className="flex-row flex-wrap gap-2">
            <View className="px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30">
              <Text className="text-xs font-medium text-lantern-success">Income {formatCurrency(monthlyIncome)}</Text>
            </View>
            <View className="px-2.5 py-1 rounded-full bg-lantern-accent-background">
              <Text className="text-xs font-medium text-lantern-accent">Spent {formatCurrency(monthlyExpenses)}</Text>
            </View>
            <View className="px-2.5 py-1 rounded-full bg-lantern-primary-background">
              <Text className="text-xs font-medium text-lantern-primary">Net {formatCurrency(netAmount)}</Text>
            </View>
          </View>
        </FeatureHero>
      </View>

      <View style={[styles.tabBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabItem, activeTab === tab.key && { borderBottomColor: featureAccents.budget }]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={activeTab === tab.key ? featureAccents.budget : colors.textSecondary}
            />
            <Text
              style={[
                styles.tabLabel,
                { color: activeTab === tab.key ? featureAccents.budget : colors.textSecondary },
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={featureAccents.budget}
            colors={[featureAccents.budget]}
          />
        }
      >
        {activeTab === 'overview' && (
          <>
        {/* Budget Progress Card */}
        <View style={[styles.budgetCard, { backgroundColor: colors.card }]}>
          <View style={styles.budgetHeader}>
            <Text style={[styles.budgetTitle, { color: colors.text }]}>This Month's Budget</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('SetBudget')}
            >
              <Text style={styles.editBudgetText}>
                {budget ? 'Edit' : 'Set Budget'}
              </Text>
            </TouchableOpacity>
          </View>

          {activeBudget ? (
            <>
              <View style={styles.budgetAmounts}>
                <Text style={[styles.spentAmount, { color: colors.text }]}>{formatCurrency(monthlyExpenses)}</Text>
                <Text style={[styles.totalAmount, { color: colors.textSecondary }]}>/ {formatCurrency(activeBudget.monthlyLimit)}</Text>
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
                  ? `${formatCurrency(activeBudget.monthlyLimit - monthlyExpenses)} left to spend`
                  : `${formatCurrency(monthlyExpenses - activeBudget.monthlyLimit)} over budget`}
              </Text>

              {/* Pace — "85% spent" means nothing without knowing it is day 3. */}
              {spendPace.verdict !== 'no-budget' && (
                <View style={styles.paceRow}>
                  <Ionicons
                    name={
                      spendPace.verdict === 'over'
                        ? 'alert-circle'
                        : spendPace.verdict === 'ahead'
                          ? 'trending-up'
                          : 'checkmark-circle'
                    }
                    size={14}
                    color={
                      spendPace.verdict === 'over'
                        ? '#ef4444'
                        : spendPace.verdict === 'ahead'
                          ? '#f59e0b'
                          : '#22c55e'
                    }
                  />
                  <Text style={[styles.paceText, { color: colors.textSecondary }]}>
                    {`Day ${pace.daysElapsed} of ${pace.daysInPeriod} (${Math.round(pace.elapsedRatio * 100)}%) · ${Math.round(spendPace.spentRatio * 100)}% spent`}
                    {spendPace.verdict === 'ahead'
                      ? ` — ${formatCurrency(Math.round(spendPace.spendVsExpected))} ahead of pace`
                      : ''}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <View style={[styles.noBudgetContainer, { borderColor: colors.border }]}>
              <Ionicons name="wallet-outline" size={40} color={colors.textSecondary} />
              <Text style={[styles.noBudgetText, { color: colors.textSecondary }]}>No budget set for this month</Text>
              <TouchableOpacity
                style={styles.setBudgetButton}
                onPress={() => navigation.navigate('SetBudget')}
              >
                <Text style={styles.setBudgetButtonText}>Set a monthly budget</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Zero-based check: every unit of planned income needs a job. */}
          {planSummary.totalPlannedIncome > 0 && (
            <View
              style={[
                styles.allocateRow,
                {
                  borderTopColor: colors.border,
                  backgroundColor: planSummary.isBalanced ? '#22c55e18' : 'transparent',
                },
              ]}
            >
              <Text style={[styles.allocateLabel, { color: colors.textSecondary }]}>
                {planSummary.isBalanced
                  ? 'Every naira has a job'
                  : planSummary.leftToAllocate > 0
                    ? 'Left to allocate'
                    : 'Over-committed by'}
              </Text>
              <Text
                style={[
                  styles.allocateValue,
                  {
                    color: planSummary.isBalanced
                      ? '#22c55e'
                      : planSummary.leftToAllocate > 0
                        ? colors.text
                        : '#ef4444',
                  },
                ]}
              >
                {planSummary.isBalanced
                  ? '✓'
                  : formatCurrency(Math.abs(Math.round(planSummary.leftToAllocate)))}
              </Text>
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
            onPress={() => navigation.navigate('AddExpense')}
          >
            <Ionicons name="arrow-down" size={24} color="#ffffff" />
            <Text style={styles.actionButtonText}>Add Expense</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.incomeButton]}
            onPress={() => navigation.navigate('AddIncome')}
          >
            <Ionicons name="arrow-up" size={24} color="#ffffff" />
            <Text style={styles.actionButtonText}>Add Income</Text>
          </TouchableOpacity>
        </View>

        {/* Extended tools */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, marginBottom: 16 }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>More tools</Text>
          {[
            { label: 'Savings goals', icon: 'flag-outline', route: 'SavingsGoals' },
            { label: 'Study wallet', icon: 'wallet-outline', route: 'Wallet' },
            { label: 'Expense splits', icon: 'people-outline', route: 'ExpenseSplit' },
            { label: 'Category budgets', icon: 'grid-outline', route: 'SetCategoryBudget' },
            { label: 'Financial toolkit', icon: 'analytics-outline', route: 'FinancialToolkit' },
            { label: 'Add investment', icon: 'trending-up-outline', route: 'AddInvestment' },
          ].map(item => (
            <TouchableOpacity
              key={item.route}
              style={[styles.menuRow, { borderBottomColor: colors.border }]}
              onPress={() => navigation.navigate(item.route)}
            >
              <Ionicons name={item.icon as any} size={20} color={featureAccents.budget} />
              <Text style={[styles.menuRowText, { color: colors.text }]}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
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
          </>
        )}

        {activeTab === 'transactions' && (
          <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
            <View style={styles.txFilterRow}>
              {(['all', 'income', 'expense'] as TxFilter[]).map(filter => (
                <TouchableOpacity
                  key={filter}
                  style={[
                    styles.txFilterBtn,
                    {
                      backgroundColor:
                        txFilter === filter ? featureAccents.budget : colors.backgroundSecondary,
                    },
                  ]}
                  onPress={() => setTxFilter(filter)}
                >
                  <Text
                    style={[
                      styles.txFilterText,
                      {
                        color:
                          txFilter === filter ? colors.textInverse : colors.textSecondary,
                      },
                    ]}
                  >
                    {filter === 'all' ? 'All' : filter === 'income' ? 'Income' : 'Expense'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>This Month</Text>
            {filteredTransactions.length > 0 ? (
              <View style={styles.transactionsList}>
                {filteredTransactions.map(transaction => (
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
                        {getCategoryLabel(transaction.category, transaction.type)} • {formatDate(transaction.date)}
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
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, styles.expenseButton]}
                onPress={() => navigation.navigate('AddExpense')}
              >
                <Ionicons name="arrow-down" size={20} color="#ffffff" />
                <Text style={styles.actionButtonText}>Expense</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.incomeButton]}
                onPress={() => navigation.navigate('AddIncome')}
              >
                <Ionicons name="arrow-up" size={20} color="#ffffff" />
                <Text style={styles.actionButtonText}>Income</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === 'goals' && (
          <>
            <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
              <View style={styles.goalsHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Savings goals</Text>
                <TouchableOpacity onPress={() => navigation.navigate('SavingsGoals')}>
                  <Text style={styles.editBudgetText}>Manage</Text>
                </TouchableOpacity>
              </View>
              {savingsGoals.length === 0 ? (
                <Text style={[styles.emptyChartText, { color: colors.textSecondary }]}>No savings goals yet.</Text>
              ) : (
                savingsGoals.slice(0, 5).map(goal => {
                  const pct = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
                  return (
                    <View key={goal.id} style={{ marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: colors.text, fontWeight: '600' }}>{goal.name}</Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                          {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
                        </Text>
                      </View>
                      <View style={[styles.progressBackground, { backgroundColor: colors.border, marginTop: 6 }]}>
                        <View style={[styles.progressBar, { width: `${pct}%`, backgroundColor: '#22c55e' }]} />
                      </View>
                    </View>
                  );
                })
              )}
            </View>
            <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
              <View style={styles.goalsHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Expense splits</Text>
                <TouchableOpacity onPress={() => navigation.navigate('ExpenseSplit')}>
                  <Text style={styles.editBudgetText}>Manage</Text>
                </TouchableOpacity>
              </View>
              {expenseSplits.length === 0 ? (
                <Text style={[styles.emptyChartText, { color: colors.textSecondary }]}>No expense splits yet.</Text>
              ) : (
                expenseSplits.slice(0, 5).map(split => (
                  <View key={split.id} style={[styles.menuRow, { borderBottomColor: colors.border }]}>
                    <Text style={{ flex: 1, color: colors.text }}>{split.title}</Text>
                    <Text style={{ color: colors.textSecondary }}>{formatCurrency(split.totalAmount)}</Text>
                  </View>
                ))
              )}
            </View>
            <TouchableOpacity
              style={[styles.sectionCard, { backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center', gap: 12 }]}
              onPress={() => navigation.navigate('Wallet')}
            >
              <Ionicons name="wallet-outline" size={24} color="#6366f1" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>Study wallet</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{walletBalance} coins</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </>
        )}

        {activeTab === 'insights' && (
          <>
            <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Summary</Text>
              <View style={styles.insightsGrid}>
                <View style={[styles.insightItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Budget used</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{Math.round(budgetProgress)}%</Text>
                </View>
                <View style={[styles.insightItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Avg daily</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{formatCurrency(avgDailySpend)}</Text>
                </View>
                <View style={[styles.insightItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Projected</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{formatCurrency(projectedMonth)}</Text>
                </View>
                <View style={[styles.insightItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Transactions</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{monthlyTransactions.length}</Text>
                </View>
              </View>
            </View>
            {biggestCategory ? (
              <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Biggest category</Text>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{biggestCategory.name}</Text>
                <Text style={{ color: colors.textSecondary, marginTop: 4 }}>{formatCurrency(biggestCategory.amount)} this month</Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={[styles.sectionCard, { backgroundColor: colors.card }]}
              onPress={() => navigation.navigate('FinancialToolkit')}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Ionicons name="bulb-outline" size={28} color="#06b6d4" />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Financial toolkit</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Tips, simulator & calculator</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
            {pieData.length > 0 ? (
              <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Spending breakdown</Text>
                <View style={styles.chartContainer}>
                  <PieChart
                    data={pieData}
                    donut
                    radius={70}
                    innerRadius={45}
                    innerCircleColor={colors.card}
                  />
                  <View style={styles.legendContainer}>
                    {expensesByCategory.slice(0, 6).map(cat => (
                      <View key={cat.name} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: cat.color }]} />
                        <Text style={[styles.legendText, { color: colors.text }]} numberOfLines={1}>{cat.name}</Text>
                        <Text style={[styles.legendAmount, { color: colors.textSecondary }]}>{formatCurrency(cat.amount)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            ) : null}
          </>
        )}

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
  paceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  paceText: {
    fontSize: 12,
    flexShrink: 1,
  },
  allocateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 12,
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderRadius: 10,
  },
  allocateLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  allocateValue: {
    fontSize: 16,
    fontWeight: '700',
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
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  menuRowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: '#6366f1',
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  txFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  txFilterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#334155',
  },
  txFilterBtnActive: {
    backgroundColor: '#6366f1',
  },
  txFilterText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  txFilterTextActive: {
    color: '#ffffff',
  },
  goalsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  insightsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  insightItem: {
    width: '47%',
    backgroundColor: '#334155',
    borderRadius: 12,
    padding: 12,
  },
});
