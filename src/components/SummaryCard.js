import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, type } from '../theme';
import { formatINR } from '../utils/format';

export default function SummaryCard({ label, amount, previous, count, topCategory }) {
  const delta = previous > 0 ? (amount - previous) / previous : null;
  const up = delta !== null && delta > 0;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>{label.toUpperCase()}</Text>
      <Text style={styles.amount}>{formatINR(amount)}</Text>

      <View style={styles.row}>
        {delta !== null && (
          <View style={[styles.pill, { backgroundColor: up ? 'rgba(255,107,107,0.15)' : 'rgba(59,217,166,0.15)' }]}>
            <Text style={[styles.pillText, { color: up ? colors.coral : colors.mint }]}>
              {up ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(0)}% vs prev
            </Text>
          </View>
        )}
        <Text style={styles.meta}>
          {count} {count === 1 ? 'txn' : 'txns'}
          {topCategory ? `  ·  Top: ${topCategory.icon} ${topCategory.label}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: { ...type.tiny, color: colors.textFaint },
  amount: { ...type.hero, color: colors.text, marginTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, flexWrap: 'wrap' },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    marginRight: spacing.md,
  },
  pillText: { ...type.tiny },
  meta: { ...type.small, color: colors.textDim },
});
