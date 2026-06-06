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

export const CHALLENGE_STAGE_CONFIG = {
  totalStages: 7,
} as const;

export const CHALLENGE_AI_STAGE_CONFIG = {
  1: {
    id: 'BEGINNER',
    name: '新手型对手',
    rerollChance: 0.08,
    attackMaxCards: 2,
    preferSingleAttackChance: 0.65,
    defendPassChance: 0.55,
    defendFullChance: 0.1,
  },
  2: {
    id: 'BASIC',
    name: '基础型对手',
    rerollChance: 0.16,
    attackMaxCards: 2,
    preferSingleAttackChance: 0.4,
    defendPassChance: 0.3,
    defendFullChance: 0.2,
  },
  default: {
    id: 'STANDARD',
    name: '标准型对手',
    rerollChance: 0.3,
    attackMaxCards: 3,
    preferSingleAttackChance: 0,
    defendPassChance: 0,
    defendFullChance: 0,
  },
} as const;

export const getChallengeAiStageConfig = (stage: number) =>
  stage === 1
    ? CHALLENGE_AI_STAGE_CONFIG[1]
    : stage === 2
      ? CHALLENGE_AI_STAGE_CONFIG[2]
      : CHALLENGE_AI_STAGE_CONFIG.default;
