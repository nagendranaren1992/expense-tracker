import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, type } from '../theme';
import { formatINR } from '../utils/format';
import { categoryMeta } from '../services/categories';
import { relativeDay, prettyTime } from '../utils/dates';
import { accountLabel } from '../config/accounts';
import { resolveStoredMerchant } from '../config/upiMerchants';

export default function TransactionList({ transactions }) {
  if (!transactions || transactions.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Transactions</Text>
        <Text style={styles.empty}>Nothing here yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Transactions</Text>
      {transactions.map((t, i) => {
        const merchant = resolveStoredMerchant(t) || t.merchant;
        const meta = categoryMeta(t.category);
        const isCredit = t.type === 'credit';
        return (
          <View
            key={t.id}
            style={[styles.row, i < transactions.length - 1 && styles.rowBorder]}
          >
            <View style={[styles.icon, { backgroundColor: meta.color + '22' }]}>
              <Text style={styles.iconText}>{meta.icon}</Text>
            </View>
            <View style={styles.mid}>
              <Text style={styles.merchant} numberOfLines={1}>
                {merchant}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {meta.label}
                {t.account ? `  ·  ${accountLabel(t.account)}` : ''}
                {'  ·  '}
                {relativeDay(t.date)}, {prettyTime(t.date)}
              </Text>
            </View>
            <Text style={[styles.amount, { color: isCredit ? colors.mint : colors.text }]}>
              {isCredit ? '+' : '−'}
              {formatINR(t.amount).replace('₹', '₹')}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { ...type.h2, color: colors.text, marginBottom: spacing.md },
  empty: { ...type.body, color: colors.textFaint, paddingVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  iconText: { fontSize: 18 },
  mid: { flex: 1, marginRight: spacing.sm },
  merchant: { ...type.h2, color: colors.text },
  sub: { ...type.small, color: colors.textFaint, marginTop: 2 },
  amount: { ...type.h2 },
});