export type GameMode = 'QUICK' | 'CHALLENGE';

export const GAME_MODE_CONFIG = {
  QUICK: {
    id: 'QUICK',
    name: '快速对局',
    environmentMode: 'SINGLE',
    environmentRoute: ['VOLCANO'],
    mutationLimit: 3,
    mutationIntervalRounds: 2,
  },
  CHALLENGE: {
    id: 'CHALLENGE',
    name: '挑战模式',
    environmentMode: 'ROTATION',
    environmentRoute: ['VOLCANO', 'FOREST', 'GLACIER'],
    mutationLimit: 4,
    roundsPerEnvironment: 2,
    mutationIntervalRounds: 2,
  },
} as const;
