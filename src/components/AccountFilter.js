import React, { useMemo, useState, useCallback } from 'react';
import { View, ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, type } from '../theme';
import { MY_ACCOUNTS, accountLabel } from '../config/accounts';

const THUMB = 40;

// Always show every card from MY_ACCOUNTS, even if Sync hasn't found spends yet.
export default function AccountFilter({ accounts = [], value, onChange }) {
  const options = useMemo(() => {
    const configured = MY_ACCOUNTS.map((a) => a.last4);
    const extras = (accounts || []).filter((a) => a && !configured.includes(a));
    return ['all', ...configured, ...extras];
  }, [accounts]);

  const [metrics, setMetrics] = useState({
    contentW: 0,
    viewW: 0,
    offsetX: 0,
  });

  const needed = metrics.contentW > metrics.viewW + 2;
  const maxScroll = Math.max(1, metrics.contentW - metrics.viewW);
  const ratio = Math.min(1, Math.max(0, metrics.offsetX / maxScroll));
  const travel = Math.max(0, (metrics.viewW || 0) - THUMB);
  const thumbLeft = ratio * travel;

  const onScroll = useCallback((e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    setMetrics({
      contentW: contentSize.width,
      viewW: layoutMeasurement.width,
      offsetX: contentOffset.x,
    });
  }, []);

  const onContentSizeChange = useCallback((w) => {
    setMetrics((m) => ({ ...m, contentW: w }));
  }, []);

  const onLayout = useCallback((e) => {
    setMetrics((m) => ({ ...m, viewW: e.nativeEvent.layout.width }));
  }, []);

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onContentSizeChange}
        onLayout={onLayout}
        contentContainerStyle={styles.row}
      >
        {options.map((acc) => {
          const active = value === acc;
          return (
            <Pressable
              key={acc}
              onPress={() => onChange(acc)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.text, active && styles.textActive]}>
                {acc === 'all' ? 'All accounts' : accountLabel(acc)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {needed ? (
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.thumb, { left: thumbLeft, width: THUMB }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs, paddingRight: spacing.lg },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: { ...type.small, color: colors.textDim },
  textActive: { color: colors.white, fontWeight: '600' },
  track: {
    marginTop: spacing.sm,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    opacity: 0.65,
  },
});
