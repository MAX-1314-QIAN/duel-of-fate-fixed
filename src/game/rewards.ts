import { ACTIVE_BALANCE_CONFIG } from './balance';

export type StageItemRewardId = 'HAND_SLOT' | 'MAX_HP' | 'SHIELD_CHARGE';

export interface StageItemRewardConfig {
  id: StageItemRewardId;
  icon: string;
  name: string;
  description: string;
}

export const CHALLENGE_REWARD_CONFIG = {
  basePlayerMaxHp: ACTIVE_BALANCE_CONFIG.playerInitialMaxHp,
  basePlayerShield: ACTIVE_BALANCE_CONFIG.playerInitialShield,
  shieldLimit: 12,
  basePlayerHandLimit: ACTIVE_BALANCE_CONFIG.playerBaseHandLimit,
  handSlotBonus: 1,
  maxHpBonus: 5,
  itemRewardFirstStage: 3,
  itemRewardLastStage: 6,
} as const;

export const STAGE_ITEM_REWARDS: StageItemRewardConfig[] = [
  {
    id: 'HAND_SLOT',
    icon: '🃏',
    name: '手牌扩容',
    description: '手牌槽位上限 +1',
  },
  {
    id: 'MAX_HP',
    icon: '❤️',
    name: '生命增幅',
    description: '最大生命 +5，当前生命 +5',
  },
  {
    id: 'SHIELD_CHARGE',
    icon: '🛡️',
    name: '护盾充能',
    description: '护盾恢复至 12',
  },
];

export const isItemRewardStage = (stage: number) =>
  stage >= CHALLENGE_REWARD_CONFIG.itemRewardFirstStage
  && stage <= CHALLENGE_REWARD_CONFIG.itemRewardLastStage;
