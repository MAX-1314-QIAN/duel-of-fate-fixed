import { CardType } from '../types';

export type BalanceProfile = 'DEV' | 'FORMAL';

export const BALANCE_PROFILE: BalanceProfile = 'DEV';

export const BALANCE_PROFILES = {
  DEV: {
    playerInitialMaxHp: 10,
    sharedDeckCopiesPerCardType: 10,
    sharedDeckTotalCards: 30,
    playerInitialShield: 0,
    playerBaseHandLimit: 4,
    aiBaseHandLimit: 4,
  },
  FORMAL: {
    playerInitialMaxHp: 30,
    sharedDeckCopiesPerCardType: 22,
    sharedDeckTotalCards: 66,
    playerInitialShield: 0,
    playerBaseHandLimit: 4,
    aiBaseHandLimit: 4,
  },
} as const;

export const ACTIVE_BALANCE_CONFIG = BALANCE_PROFILES[BALANCE_PROFILE];

export const SHARED_DECK_CARD_TYPES: CardType[] = ['ROCK', 'PAPER', 'SCISSORS'];

export const CHALLENGE_AI_HP_BY_STAGE = {
  1: 10,
  2: 10,
  3: 15,
  4: 15,
  5: 20,
  6: 18,
  7: 20,
} as const;
