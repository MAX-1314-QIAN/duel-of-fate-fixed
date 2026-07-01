import { GameMode } from './mode';

export const CHALLENGE_RUN_SAVE_KEY = 'duel-of-fate-challenge-save';
export const CHALLENGE_RUN_SAVE_SCHEMA_VERSION = 1;

export type ChallengeRunSave = {
  schemaVersion: number;
  savedAt: string;
  gameMode: GameMode;
  challengeStage: number;
  state: unknown;
  logs: string[];
  challengeStageClear: unknown;
  faithState: unknown;
  playerDewdrops: number;
  playerFrostSigils: number;
  playerMaxHp: number;
  playerShield: number;
  playerHandLimit: number;
  hasClaimedHandSlotReward: boolean;
  selectedStageReward: unknown;
  selectedStageItemReward: unknown;
  claimedStageRewardStages: number[];
  claimedItemRewardStages: number[];
  completedClashCount: number;
  completedClashesSinceMutation: number;
  environmentRouteIndex: number;
  environmentRoundsRemaining: number;
  enemyScorchMarks: number;
  bossPressure: number;
  hasTriggeredCoreCombustionThisEnemy: boolean;
  hasTriggeredVerdantSurgeThisEnemy: boolean;
  hasTriggeredBlizzardThisEnemy: boolean;
};

export const validateChallengeRunSave = (value: unknown): value is ChallengeRunSave => {
  if (!value || typeof value !== 'object') return false;
  const save = value as Partial<ChallengeRunSave>;

  return save.schemaVersion === CHALLENGE_RUN_SAVE_SCHEMA_VERSION
    && save.gameMode === 'CHALLENGE'
    && typeof save.savedAt === 'string'
    && typeof save.challengeStage === 'number'
    && Boolean(save.state)
    && Array.isArray(save.logs)
    && Boolean(save.faithState)
    && Array.isArray(save.claimedStageRewardStages)
    && Array.isArray(save.claimedItemRewardStages);
};

export const loadChallengeRun = (): ChallengeRunSave | null => {
  try {
    const raw = localStorage.getItem(CHALLENGE_RUN_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!validateChallengeRunSave(parsed)) {
      localStorage.removeItem(CHALLENGE_RUN_SAVE_KEY);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(CHALLENGE_RUN_SAVE_KEY);
    return null;
  }
};

export const saveChallengeRun = (save: ChallengeRunSave) => {
  localStorage.setItem(CHALLENGE_RUN_SAVE_KEY, JSON.stringify(save));
};

export const clearChallengeRun = () => {
  localStorage.removeItem(CHALLENGE_RUN_SAVE_KEY);
};

export const hasChallengeRunSave = () => loadChallengeRun() !== null;
