import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { colors, spacing, radius, type } from '../theme';
import { formatINR } from '../utils/format';

const SIZE = 160;
const STROKE = 22;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

// data: [{ key, label, icon, color, amount, pct }] sorted desc
export default function CategoryBreakdown({ data, total }) {
  if (!data || data.length === 0) {
    return (
      <View style={[styles.card, styles.empty]}>
        <Text style={styles.emptyText}>No spending in this period.</Text>
      </View>
    );
  }

  let offset = 0;
  const segments = data.map((d) => {
    const len = d.pct * CIRC;
    const seg = { ...d, dash: `${len} ${CIRC - len}`, offset: -offset };
    offset += len;
    return seg;
  });

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Where it went</Text>

      <View style={styles.body}>
        <View style={styles.donutWrap}>
          <Svg width={SIZE} height={SIZE}>
            <G rotation={-90} origin={`${SIZE / 2}, ${SIZE / 2}`}>
              <Circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                stroke={colors.surfaceAlt}
                strokeWidth={STROKE}
                fill="none"
              />
              {segments.map((s) => (
                <Circle
                  key={s.key}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  stroke={s.color}
                  strokeWidth={STROKE}
                  strokeDasharray={s.dash}
                  strokeDashoffset={s.offset}
                  strokeLinecap="butt"
                  fill="none"
                />
              ))}
            </G>
          </Svg>
          <View style={styles.donutCenter}>
            <Text style={styles.centerLabel}>TOTAL</Text>
            <Text style={styles.centerValue}>{formatINR(total, { compact: true })}</Text>
          </View>
        </View>

        <View style={styles.legend}>
          {data.slice(0, 6).map((d) => (
            <View key={d.key} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: d.color }]} />
              <Text style={styles.legendLabel} numberOfLines={1}>
                {d.icon} {d.label}
              </Text>
              <Text style={styles.legendPct}>{Math.round(d.pct * 100)}%</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.divider} />

      {data.map((d) => (
        <View key={d.key} style={styles.detailRow}>
          <View style={[styles.dot, { backgroundColor: d.color }]} />
          <Text style={styles.detailLabel}>
            {d.icon} {d.label}
          </Text>
          <Text style={styles.detailAmount}>{formatINR(d.amount)}</Text>
        </View>
      ))}
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
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyText: { ...type.body, color: colors.textFaint },
  title: { ...type.h2, color: colors.text, marginBottom: spacing.lg },
  body: { flexDirection: 'row', alignItems: 'center' },
  donutWrap: { width: SIZE, height: SIZE, justifyContent: 'center', alignItems: 'center' },
  donutCenter: { position: 'absolute', alignItems: 'center' },
  centerLabel: { ...type.tiny, color: colors.textFaint },
  centerValue: { ...type.h1, color: colors.text },
  legend: { flex: 1, paddingLeft: spacing.lg, gap: spacing.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.sm },
  legendLabel: { ...type.small, color: colors.textDim, flex: 1 },
  legendPct: { ...type.small, color: colors.text, fontWeight: '600' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  detailLabel: { ...type.body, color: colors.text, flex: 1 },
  detailAmount: { ...type.body, color: colors.text, fontWeight: '600' },
});
