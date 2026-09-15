/**
 * Budget stack -> FinancialToolkit. Three offline tools behind one segmented
 * header: static money tips, a percentage allocation simulator, and a compound
 * savings calculator.
 *
 * Exports: FinancialToolkitScreen (default).
 * Touches: budgetStore monthlyIncome / monthlyExpenses for the two summary
 * tiles; @react-native-community/slider. Nothing here writes to the store or
 * the API, and no figure entered in the simulator or calculator is saved.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import { useBudgetStore, formatCurrency } from '../../stores/budgetStore';
import { ScreenHeader, Card } from '../../components/ui';
import { Screen, useScreenBottomPadding } from '../../components/layout';

type ToolkitMode = 'tips' | 'simulator' | 'calculator';

const QUICK_TIPS = [
  { icon: '🍔', title: 'Food Budget Hack', tip: 'Buy foodstuff weekly and cook in bulk. Saves up to ₦15,000/month vs buying from canteens daily.' },
  { icon: '📱', title: 'Data Saving', tip: 'Use night plans for heavy downloads. Restrict background data. Campus Wi-Fi for lectures.' },
  { icon: '🚌', title: 'Transport Smart', tip: 'Walk for short distances. Group transport with classmates. Explore monthly passes if available.' },
  { icon: '📚', title: 'Textbook Tips', tip: 'Buy used textbooks or share with coursemates. Use the Marketplace to sell after the semester.' },
  { icon: '🐷', title: 'The ₦100 Challenge', tip: 'Save ₦100 on Day 1, ₦200 on Day 2... By Day 30, you\'ve saved ₦46,500!' },
  { icon: '💡', title: 'Needs vs Wants', tip: 'Before buying anything, wait 24 hours. If you still need it tomorrow, it\'s probably a need.' },
  { icon: '📊', title: 'Track Everything', tip: 'Log every ₦50+ expense. Most people underestimate spending by 30% when they don\'t track.' },
  { icon: '🎉', title: 'Budget for Fun', tip: 'Allocate 10-15% for social activities. Deprivation budgets fail — allow yourself controlled fun.' },
];

export default function FinancialToolkitScreen() {
  const navigation = useNavigation<any>();
  // Budget-stack screen: the bottom tab bar overlays it, so the calculator
  // result card and the last tip need its clearance, not a `pb-8`.
  const bottomPadding = useScreenBottomPadding();
  const { monthlyExpenses, monthlyIncome } = useBudgetStore();
  const [mode, setMode] = useState<ToolkitMode>('tips');
  const [simIncome, setSimIncome] = useState('');
  const [simFood, setSimFood] = useState(30);
  const [simTransport, setSimTransport] = useState(15);
  const [simData, setSimData] = useState(10);
  const [simSavings, setSimSavings] = useState(20);
  const [calcAmount, setCalcAmount] = useState('');
  const [calcRate, setCalcRate] = useState('15');
  const [calcMonths, setCalcMonths] = useState('12');

  const simIncomeVal = parseFloat(simIncome) || 0;
  const simResult = useMemo(() => {
    const food = simIncomeVal * simFood / 100;
    const transport = simIncomeVal * simTransport / 100;
    const data = simIncomeVal * simData / 100;
    const savings = simIncomeVal * simSavings / 100;
    const allocated = food + transport + data + savings;
    const remaining = simIncomeVal - allocated;
    return { remaining, pctUsed: simIncomeVal > 0 ? (allocated / simIncomeVal) * 100 : 0 };
  }, [simIncomeVal, simFood, simTransport, simData, simSavings]);

  const calcResult = useMemo(() => {
    const p = parseFloat(calcAmount) || 0;
    const r = (parseFloat(calcRate) || 0) / 100 / 12;
    const n = parseInt(calcMonths, 10) || 0;
    if (p <= 0 || n <= 0) return { total: 0, interest: 0 };
    const total = r > 0 ? p * Math.pow(1 + r, n) : p;
    return { total, interest: total - p };
  }, [calcAmount, calcRate, calcMonths]);

  return (
    <Screen bottom="none" keyboard>
      <ScreenHeader title="Financial toolkit" onBack={() => navigation.goBack()} subtitle="Tips, simulator & calculator" />
      <View className="flex-row border-b border-lantern-border px-2">
        {([
          { key: 'tips' as const, label: '💡 Tips' },
          { key: 'simulator' as const, label: '📊 Simulator' },
          { key: 'calculator' as const, label: '🧮 Calculator' },
        ]).map(tab => (
          <Text
            key={tab.key}
            onPress={() => setMode(tab.key)}
            className={`flex-1 text-center py-3 text-xs font-semibold ${
              mode === tab.key ? 'text-cyan-600 border-b-2 border-cyan-500' : 'text-lantern-text-tertiary'
            }`}
          >
            {tab.label}
          </Text>
        ))}
      </View>
      <ScrollView
        contentContainerClassName="px-4 gap-3 pt-3"
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row gap-3">
          <Card className="flex-1 items-center py-3">
            <Text className="text-xs text-lantern-text-secondary">Income</Text>
            <Text className="text-base font-bold text-emerald-600">{formatCurrency(monthlyIncome)}</Text>
          </Card>
          <Card className="flex-1 items-center py-3">
            <Text className="text-xs text-lantern-text-secondary">Expenses</Text>
            <Text className="text-base font-bold text-red-500">{formatCurrency(monthlyExpenses)}</Text>
          </Card>
        </View>

        {mode === 'tips' && QUICK_TIPS.map((tip, i) => (
          <Card key={i} className="p-4 flex-row gap-3">
            <Text className="text-2xl">{tip.icon}</Text>
            <View className="flex-1">
              <Text className="font-semibold text-lantern-text dark:text-white">{tip.title}</Text>
              <Text className="text-sm text-lantern-text-secondary mt-1 leading-5">{tip.tip}</Text>
            </View>
          </Card>
        ))}

        {mode === 'simulator' && (
          <Card className="p-4 gap-4">
            <Text className="text-sm text-lantern-text-secondary">Enter monthly income and adjust category percentages.</Text>
            <TextInput
              value={simIncome}
              onChangeText={setSimIncome}
              placeholder="Monthly income (₦)"
              keyboardType="decimal-pad"
              placeholderTextColor="#94a3b8"
              className="border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white bg-lantern-surface"
            />
            {[
              { label: '🍔 Food', value: simFood, set: setSimFood },
              { label: '🚌 Transport', value: simTransport, set: setSimTransport },
              { label: '📱 Data', value: simData, set: setSimData },
              { label: '🐷 Savings', value: simSavings, set: setSimSavings },
            ].map(row => (
              <View key={row.label}>
                <View className="flex-row justify-between mb-1">
                  <Text className="text-sm text-lantern-text-secondary">{row.label}</Text>
                  <Text className="text-sm font-medium text-lantern-text">
                    {row.value}% = {formatCurrency(simIncomeVal * row.value / 100)}
                  </Text>
                </View>
                <Slider
                  minimumValue={0}
                  maximumValue={50}
                  step={1}
                  value={row.value}
                  onValueChange={row.set}
                  minimumTrackTintColor="#06b6d4"
                  maximumTrackTintColor="#cbd5e1"
                />
              </View>
            ))}
            <View className="bg-lantern-background-secondary dark:bg-lantern-surface-secondary/50 rounded-xl p-3">
              <Text className="text-sm text-lantern-text-secondary">Allocated: {simResult.pctUsed.toFixed(0)}%</Text>
              <Text className={`text-sm font-semibold mt-1 ${simResult.remaining >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                Remaining: {formatCurrency(simResult.remaining)}
              </Text>
            </View>
          </Card>
        )}

        {mode === 'calculator' && (
          <Card className="p-4 gap-3">
            <Text className="text-sm text-lantern-text-secondary">Compound savings calculator</Text>
            <TextInput value={calcAmount} onChangeText={setCalcAmount} placeholder="Starting amount (₦)" keyboardType="decimal-pad" placeholderTextColor="#94a3b8" className="border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white bg-lantern-surface" />
            <TextInput value={calcRate} onChangeText={setCalcRate} placeholder="Annual rate (%)" keyboardType="decimal-pad" placeholderTextColor="#94a3b8" className="border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white bg-lantern-surface" />
            <TextInput value={calcMonths} onChangeText={setCalcMonths} placeholder="Months" keyboardType="number-pad" placeholderTextColor="#94a3b8" className="border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white bg-lantern-surface" />
            <View className="bg-cyan-50 dark:bg-cyan-900/20 rounded-xl p-4 mt-2">
              <Text className="text-sm text-lantern-text-secondary">Projected total</Text>
              <Text className="text-2xl font-bold text-cyan-600">{formatCurrency(calcResult.total)}</Text>
              <Text className="text-sm text-lantern-text-secondary mt-1">Interest earned: {formatCurrency(calcResult.interest)}</Text>
            </View>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
