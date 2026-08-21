import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  ImageBackground,
  Image,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { colors, spacing, radius } from '../theme';

const heroImage = require('../../assets/login-hero.png');
const markImage = require('../../assets/favicon.png');

export default function LoginScreen({ onSignIn, loading, status, setupHint }) {
  const { width } = useWindowDimensions();
  const wide = width >= 860;
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(18)).current;
  const ctaPulse = useRef(new Animated.Value(1)).current;

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: 700,
        useNativeDriver: true,
      }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaPulse, {
          toValue: 1.015,
          duration: 1600,
          useNativeDriver: true,
        }),
        Animated.timing(ctaPulse, {
          toValue: 1,
          duration: 1600,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [fade, rise, ctaPulse]);

  const brandFont = fontsLoaded ? { fontFamily: 'Fraunces_600SemiBold' } : null;
  const bodyFont = fontsLoaded ? { fontFamily: 'DMSans_400Regular' } : null;
  const mediumFont = fontsLoaded ? { fontFamily: 'DMSans_500Medium' } : null;
  const boldFont = fontsLoaded ? { fontFamily: 'DMSans_700Bold' } : null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ImageBackground
        source={heroImage}
        style={styles.hero}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      >
        <LinearGradient
          colors={
            wide
              ? [
                  'rgba(14,17,22,0.94)',
                  'rgba(14,17,22,0.78)',
                  'rgba(14,17,22,0.35)',
                  'rgba(14,17,22,0.18)',
                ]
              : [
                  'rgba(14,17,22,0.45)',
                  'rgba(14,17,22,0.72)',
                  'rgba(14,17,22,0.92)',
                ]
          }
          locations={wide ? [0, 0.35, 0.7, 1] : [0, 0.45, 1]}
          start={wide ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 }}
          end={wide ? { x: 1, y: 0.5 } : { x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={[styles.stage, wide && styles.stageWide]}>
          <Animated.View
            style={[
              styles.copy,
              wide && styles.copyWide,
              { opacity: fade, transform: [{ translateY: rise }] },
            ]}
          >
            <View style={styles.brandRow}>
              <Image
                source={markImage}
                style={styles.mark}
                accessibilityLabel="Spends mark"
              />
              <Text style={[styles.brand, brandFont]}>Spends</Text>
            </View>

            <Text style={[styles.headline, brandFont]}>
              Your inbox already knows what you spent.
            </Text>

            <Text style={[styles.support, bodyFont]}>
              Sign in once. We read your bank alert emails — nothing else — and
              turn them into a clear daily and weekly spend picture.
            </Text>

            <Animated.View
              style={{ transform: [{ scale: loading ? 1 : ctaPulse }] }}
            >
              <Pressable
                style={({ pressed }) => [
                  styles.btn,
                  pressed && !loading && styles.btnPressed,
                  loading && styles.btnDisabled,
                ]}
                onPress={onSignIn}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Continue with Google"
              >
                {loading ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <View style={styles.btnInner}>
                    <View style={styles.googleBadge}>
                      <Text style={styles.googleG}>G</Text>
                    </View>
                    <Text style={[styles.btnText, boldFont]}>
                      Continue with Google
                    </Text>
                  </View>
                )}
              </Pressable>
            </Animated.View>

            <Text style={[styles.trust, bodyFont]}>
              Read-only Gmail access · Data stays on this device under your
              account
            </Text>

            {!!status && (
              <Text style={[styles.status, mediumFont]}>{status}</Text>
            )}
            {!!setupHint && (
              <Text style={[styles.status, bodyFont]}>{setupHint}</Text>
            )}
          </Animated.View>

          {wide ? <View style={styles.visualSpacer} pointerEvents="none" /> : null}
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  hero: {
    flex: 1,
    width: '100%',
  },
  stage: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.xl,
    paddingBottom: Platform.OS === 'web' ? 64 : 48,
    paddingTop: 56,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  stageWide: {
    maxWidth: 1120,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 64,
    paddingBottom: 64,
  },
  copy: {
    width: '100%',
  },
  copyWide: {
    maxWidth: 460,
    flexShrink: 1,
  },
  visualSpacer: {
    flex: 1.15,
    minWidth: 48,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: spacing.xl,
  },
  mark: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  brand: {
    fontSize: 44,
    fontWeight: '600',
    letterSpacing: -1.4,
    color: colors.text,
    lineHeight: 50,
  },
  headline: {
    fontSize: Platform.OS === 'web' ? 38 : 30,
    fontWeight: '600',
    letterSpacing: -0.9,
    color: colors.text,
    lineHeight: Platform.OS === 'web' ? 46 : 38,
    marginBottom: spacing.lg,
    maxWidth: 430,
  },
  support: {
    fontSize: 16,
    lineHeight: 25,
    color: colors.textDim,
    marginBottom: spacing.xxl,
    maxWidth: 400,
  },
  btn: {
    backgroundColor: colors.mint,
    borderRadius: radius.md,
    paddingVertical: 16,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    alignSelf: 'stretch',
    maxWidth: 360,
  },
  btnPressed: {
    opacity: 0.9,
  },
  btnDisabled: { opacity: 0.7 },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  googleBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleG: {
    color: '#4285F4',
    fontSize: 15,
    fontWeight: '700',
    marginTop: -1,
  },
  btnText: {
    fontSize: 16,
    color: colors.bg,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  trust: {
    marginTop: spacing.lg,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textFaint,
    maxWidth: 360,
  },
  status: {
    marginTop: spacing.lg,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textDim,
    maxWidth: 400,
  },
});
