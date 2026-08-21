import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, type } from '../theme';
import { prettyRange } from '../utils/dates';

const OPTIONS = [
  { key: 'daily', label: 'Today' },
  { key: 'weekly', label: 'This Week' },
  { key: 'custom', label: '📅' },
];

export default function PeriodToggle({ value, onChange, range, onPressCustom }) {
  return (
    <View style={styles.wrap}>
      {OPTIONS.map((opt) => {
        const active = value === opt.key;
        const customLabel =
          opt.key === 'custom' && active && range?.from && range?.to
            ? prettyRange(range.from, range.to)
            : opt.label;

        return (
          <Pressable
            key={opt.key}
            onPress={() => {
              if (opt.key === 'custom') {
                onPressCustom?.();
                return;
              }
              onChange(opt.key);
            }}
            style={[
              styles.seg,
              opt.key === 'custom' && active && styles.segCustomWide,
              active && styles.segActive,
            ]}
          >
            <Text
              style={[styles.text, active && styles.textActive]}
              numberOfLines={1}
            >
              {customLabel}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 4,
    gap: 2,
  },
  seg: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    minHeight: 40,
  },
  segCustomWide: { flex: 1.35 },
  segActive: { backgroundColor: colors.mint },
  text: { ...type.h2, color: colors.textDim, fontSize: 15 },
  textActive: { color: '#06231A' },
});
