import { Card, MutationType } from '../types';

export type DeityType = 'KITCHEN_GOD' | 'DEER_SPIRIT' | 'FROST_LORD';

export interface DeityConfig {
  id: DeityType;
  name: string;
  icon: string;
  mutationType: MutationType;
}

export type FaithLevel = 0 | 1 | 2 | 3 | 4;

export type FaithState = Record<DeityType, {
  faith: number;
  level: FaithLevel;
}>;

export const DEITY_CONFIG: Record<DeityType, DeityConfig> = {
  KITCHEN_GOD: {
    id: 'KITCHEN_GOD',
    name: '灶神',
    icon: '🔥',
    mutationType: 'VOLCANO',
  },
  DEER_SPIRIT: {
    id: 'DEER_SPIRIT',
    name: '鹿灵',
    icon: '🌿',
    mutationType: 'FOREST',
  },
  FROST_LORD: {
    id: 'FROST_LORD',
    name: '霜君',
    icon: '❄️',
    mutationType: 'GLACIER',
  },
};

export const DEITY_ORDER: DeityType[] = ['KITCHEN_GOD', 'DEER_SPIRIT', 'FROST_LORD'];

export const FAITH_LEVEL_THRESHOLDS = {
  1: 2,
  2: 5,
  3: 8,
  4: 16,
} as const;

export const KITCHEN_GOD_CONFIG = {
  scorchMarkLimit: 6,
  combustionMinimumMarks: 3,
  coreCombustionBonusDamage: 4,
} as const;

export const DEER_SPIRIT_CONFIG = {
  dewdropLimit: 2,
  autoHealPerClash: 1,
  chargeSafeHpRatio: 0.6,
  chargeMaxHpCost: 3,
  chargeDamagePerHp: 2,
  surgeSafeHpRatio: 0.5,
  surgeMaxHpCost: 5,
} as const;

export const FROST_LORD_CONFIG = {
  frostSigilLimit: 4,
  damagePerSigil: 1,
  coldWaveMinimumSigils: 3,
  coldWaveTemporarySigils: 1,
  blizzardFullReleaseSigils: 4,
  blizzardTemporarySigils: 2,
} as const;

export const createInitialFaithState = (): FaithState => ({
  KITCHEN_GOD: { faith: 0, level: 0 },
  DEER_SPIRIT: { faith: 0, level: 0 },
  FROST_LORD: { faith: 0, level: 0 },
});

export const getFaithLevel = (faithValue: number): FaithLevel => {
  if (faithValue >= FAITH_LEVEL_THRESHOLDS[4]) return 4;
  if (faithValue >= FAITH_LEVEL_THRESHOLDS[3]) return 3;
  if (faithValue >= FAITH_LEVEL_THRESHOLDS[2]) return 2;
  if (faithValue >= FAITH_LEVEL_THRESHOLDS[1]) return 1;
  return 0;
};

export const getNextFaithThreshold = (level: FaithLevel) =>
  level >= 4 ? null : FAITH_LEVEL_THRESHOLDS[(level + 1) as 1 | 2 | 3 | 4];

export const getOfferingFaithGain = (card: Card, deity: DeityConfig) =>
  card.mutationType === deity.mutationType ? 2 : 1;
