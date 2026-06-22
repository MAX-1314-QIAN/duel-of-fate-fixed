import { CHALLENGE_AI_HP_BY_STAGE } from './balance';

export type GameMode = 'QUICK' | 'CHALLENGE';

export type ChallengeAiProfile =
  | 'BEGINNER'
  | 'BASIC'
  | 'STANDARD'
  | 'STANDARD_PLUS'
  | 'BUILD_BUFFER'
  | 'ELITE'
  | 'BOSS_PLACEHOLDER';

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

export const CHALLENGE_STAGE_COUNT = 7;

export const CHALLENGE_STAGE_CONFIG = {
  totalStages: CHALLENGE_STAGE_COUNT,
  stages: {
    1: {
      label: '新手关',
      note: '第 1 关：新手关',
      aiHp: CHALLENGE_AI_HP_BY_STAGE[1],
      aiProfile: 'BEGINNER',
    },
    2: {
      label: '基础关',
      note: '第 2 关：基础关',
      aiHp: CHALLENGE_AI_HP_BY_STAGE[2],
      aiProfile: 'BASIC',
    },
    3: {
      label: '标准难度关',
      note: '第 3 关：标准难度关',
      aiHp: CHALLENGE_AI_HP_BY_STAGE[3],
      aiProfile: 'STANDARD',
    },
    4: {
      label: '中期压力关',
      note: '第 4 关：中期压力关',
      aiHp: CHALLENGE_AI_HP_BY_STAGE[4],
      aiProfile: 'STANDARD_PLUS',
    },
    5: {
      label: '构筑缓冲关',
      note: '第 5 关：构筑缓冲关；高 HP 用于延长战斗，提供更多感染、奉纳和神明构筑机会',
      aiHp: CHALLENGE_AI_HP_BY_STAGE[5],
      aiProfile: 'BUILD_BUFFER',
    },
    6: {
      label: '后期精英关',
      note: '第 6 关：后期精英关',
      aiHp: CHALLENGE_AI_HP_BY_STAGE[6],
      aiProfile: 'ELITE',
    },
    7: {
      label: '最终首领占位',
      note: '第 7 关：最终首领占位',
      aiHp: CHALLENGE_AI_HP_BY_STAGE[7],
      aiProfile: 'BOSS_PLACEHOLDER',
    },
  } satisfies Record<number, {
    label: string;
    note: string;
    aiHp: number;
    aiProfile: ChallengeAiProfile;
  }>,
} as const;

export const CHALLENGE_AI_PROFILE_LABELS: Record<ChallengeAiProfile, string> = {
  BEGINNER: '新手型对手',
  BASIC: '基础型对手',
  STANDARD: '标准型对手',
  STANDARD_PLUS: '中期压力型对手',
  BUILD_BUFFER: '构筑缓冲型对手',
  ELITE: '精英型对手',
  BOSS_PLACEHOLDER: '首领型对手',
};

const BEGINNER_AI_BEHAVIOR = {
  rerollChance: 0.08,
  attackMaxCards: 2,
  preferSingleAttackChance: 0.65,
  defendPassChance: 0.55,
  defendFullChance: 0.1,
} as const;

const BASIC_AI_BEHAVIOR = {
  rerollChance: 0.16,
  attackMaxCards: 2,
  preferSingleAttackChance: 0.4,
  defendPassChance: 0.3,
  defendFullChance: 0.2,
} as const;

const STANDARD_AI_BEHAVIOR = {
  rerollChance: 0.3,
  attackMaxCards: 3,
  preferSingleAttackChance: 0,
  defendPassChance: 0,
  defendFullChance: 0,
} as const;

export const CHALLENGE_AI_PROFILE_CONFIG = {
  BEGINNER: {
    id: 'BEGINNER',
    name: CHALLENGE_AI_PROFILE_LABELS.BEGINNER,
    ...BEGINNER_AI_BEHAVIOR,
  },
  BASIC: {
    id: 'BASIC',
    name: CHALLENGE_AI_PROFILE_LABELS.BASIC,
    ...BASIC_AI_BEHAVIOR,
  },
  STANDARD: {
    id: 'STANDARD',
    name: CHALLENGE_AI_PROFILE_LABELS.STANDARD,
    ...STANDARD_AI_BEHAVIOR,
  },
  STANDARD_PLUS: {
    id: 'STANDARD_PLUS',
    name: CHALLENGE_AI_PROFILE_LABELS.STANDARD_PLUS,
    ...STANDARD_AI_BEHAVIOR,
  },
  BUILD_BUFFER: {
    id: 'BUILD_BUFFER',
    name: CHALLENGE_AI_PROFILE_LABELS.BUILD_BUFFER,
    ...STANDARD_AI_BEHAVIOR,
  },
  ELITE: {
    id: 'ELITE',
    name: CHALLENGE_AI_PROFILE_LABELS.ELITE,
    ...STANDARD_AI_BEHAVIOR,
  },
  BOSS_PLACEHOLDER: {
    id: 'BOSS_PLACEHOLDER',
    name: CHALLENGE_AI_PROFILE_LABELS.BOSS_PLACEHOLDER,
    ...STANDARD_AI_BEHAVIOR,
  },
} as const;

export type ChallengeStageNumber = keyof typeof CHALLENGE_STAGE_CONFIG.stages;

export const getChallengeStageConfig = (stage: number) =>
  CHALLENGE_STAGE_CONFIG.stages[(stage as ChallengeStageNumber)] ?? CHALLENGE_STAGE_CONFIG.stages[1];

export const getChallengeAiStageConfig = (stage: number) => {
  const stageConfig = getChallengeStageConfig(stage);
  return CHALLENGE_AI_PROFILE_CONFIG[stageConfig.aiProfile];
};
