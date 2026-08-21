import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, type } from '../theme';
import { formatShort } from '../utils/format';
import { dayLabel, isSameDay } from '../utils/dates';

const MAX_BAR_HEIGHT = 120;

// data: [{ date, amount, count }] oldest -> newest
export default function WeeklyBarChart({ data, selectedDate, onSelectDay, title = 'Last 7 days' }) {
  const peak = Math.max(1, ...data.map((d) => d.amount));
  const today = new Date();
  const many = data.length > 10;
  const barWidth = many ? Math.max(8, Math.floor(160 / data.length)) : 22;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.chart}>
        {data.map((d) => {
          const h = Math.max(4, (d.amount / peak) * MAX_BAR_HEIGHT);
          const isToday = isSameDay(d.date, today);
          const isSelected = selectedDate && isSameDay(d.date, selectedDate);
          const barColor = isSelected
            ? colors.mint
            : isToday
            ? colors.accent
            : d.amount === 0
            ? colors.surfaceAlt
            : 'rgba(124,156,255,0.35)';
          return (
            <Pressable
              key={d.date.toISOString()}
              style={styles.col}
              onPress={() => onSelectDay && onSelectDay(d.date)}
            >
              <Text style={styles.value} numberOfLines={1}>
                {!many && d.amount > 0 ? formatShort(d.amount) : ''}
              </Text>
              <View style={styles.barTrack}>
                <View
                  style={[styles.bar, { height: h, width: barWidth, backgroundColor: barColor }]}
                />
              </View>
              <Text style={[styles.dow, isToday && styles.dowToday]} numberOfLines={1}>
                {many ? d.date.getDate() : dayLabel(d.date)}
              </Text>
            </Pressable>
          );
        })}
      </View>
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
  title: { ...type.h2, color: colors.text, marginBottom: spacing.lg },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: MAX_BAR_HEIGHT + 44,
  },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barTrack: { height: MAX_BAR_HEIGHT, justifyContent: 'flex-end' },
  bar: { borderRadius: radius.sm },
  value: { ...type.tiny, color: colors.textDim, marginBottom: 6, height: 14 },
  dow: { ...type.small, color: colors.textFaint, marginTop: spacing.sm },
  dowToday: { color: colors.accent, fontWeight: '700' },
});
