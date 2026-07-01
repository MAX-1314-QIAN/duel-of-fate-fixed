import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, ArrowDown, ArrowUpDown, Sword, RotateCcw, User, Cpu, ChevronRight, Info, Lock, Volume2, VolumeX, Settings } from 'lucide-react';
import { Card, CardType, GameState, MutationType, WIN_MAP } from './types';
import { zhCN } from './locales/zh-CN';
import { DrawQueueItem } from './game/sharedDeck';
import { recycleDiscardPilesIntoSharedDeck } from './game/deck';
import {
  DEITY_CONFIG,
  DEITY_ORDER,
  DeityType,
  DEER_SPIRIT_CONFIG,
  FROST_LORD_CONFIG,
  FaithState,
  FAITH_LEVEL_THRESHOLDS,
  KITCHEN_GOD_CONFIG,
  createInitialFaithState,
  getFaithLevel,
  getNextFaithThreshold,
  getOfferingFaithGain,
} from './game/faith';
import {
  ENVIRONMENT_ROUTE_CONFIG,
  FOREST_ENVIRONMENT_CONFIG,
  GLACIER_ENVIRONMENT_CONFIG,
  VOLCANO_ENVIRONMENT_CONFIG,
  advanceForestGrowth,
  applyMutationToCard,
  calculateForestRecovery,
  calculateVolcanoDamage,
  canTriggerMutation,
  countAllMutatedCards,
  getForestMutationCandidates,
  getGlacierMutationCandidates,
  getMutationCandidates,
  removeMutationFromCard,
  selectAiMutationCandidate,
} from './game/environment';
import { CHALLENGE_STAGE_CONFIG, GAME_MODE_CONFIG, GameMode, getChallengeAiStageConfig, getChallengeStageConfig } from './game/mode';
import { CHALLENGE_REWARD_CONFIG, STAGE_ITEM_REWARDS, StageItemRewardId, isItemRewardStage } from './game/rewards';
import { DEV_TOOLS_CONFIG, DEV_TOOLS_ENABLED } from './game/dev';
import { ACTIVE_BALANCE_CONFIG, SHARED_DECK_CARD_TYPES } from './game/balance';
import {
  CHALLENGE_RUN_SAVE_SCHEMA_VERSION,
  ChallengeRunSave,
  clearChallengeRun,
  hasChallengeRunSave,
  loadChallengeRun,
  saveChallengeRun,
} from './game/save';

const INITIAL_HP = ACTIVE_BALANCE_CONFIG.playerInitialMaxHp;
const PLAYER_BASE_HAND_LIMIT = ACTIVE_BALANCE_CONFIG.playerBaseHandLimit;
const AI_BASE_HAND_LIMIT = ACTIVE_BALANCE_CONFIG.aiBaseHandLimit;
const CARD_TYPES: CardType[] = SHARED_DECK_CARD_TYPES;
const CARD_NAME_ZH: Record<CardType, string> = {
  ROCK: '石头',
  PAPER: '布',
  SCISSORS: '剪刀',
};

const createCard = (type?: CardType): Card => ({
  id: Math.random().toString(36).substring(2, 11),
  type: type || CARD_TYPES[Math.floor(Math.random() * CARD_TYPES.length)],
});

const createDeck = (): Card[] => {
  const pool: Card[] = [];
  for (let i = 0; i < ACTIVE_BALANCE_CONFIG.sharedDeckCopiesPerCardType; i++) {
    CARD_TYPES.forEach(type => {
      pool.push(createCard(type));
    });
  }
  return pool.sort(() => Math.random() - 0.5);
};

const cardLabel = (type: CardType) => zhCN.cards[type];
const plainCardLabel = (type: CardType) => CARD_NAME_ZH[type];
const volcanoCardLabel = (type: CardType) => `火山${CARD_NAME_ZH[type]}`;
const forestCardLabel = (type: CardType) => `森林${CARD_NAME_ZH[type]}`;
const glacierCardLabel = (type: CardType) => `冰川${CARD_NAME_ZH[type]}`;
const forestStageLabel = (card: Card) =>
  card.forestGrowthStage === 'MATURE' ? '成熟' : '幼苗';
const forestIcon = (card: Card) =>
  card.forestGrowthStage === 'MATURE' ? '🌿' : '🌱';
const isMatureForestCard = (card: Card) =>
  card.mutationType === 'FOREST' && card.forestGrowthStage === 'MATURE';
type RoutedEnvironmentType = 'VOLCANO' | 'FOREST' | 'GLACIER';
type StageRewardState = {
  stage: number;
  deityType: DeityType;
} | null;
type StageItemRewardState = {
  stage: number;
  rewardId: StageItemRewardId;
} | null;

const ENVIRONMENT_CONFIG_BY_ID = {
  VOLCANO: VOLCANO_ENVIRONMENT_CONFIG,
  FOREST: FOREST_ENVIRONMENT_CONFIG,
  GLACIER: GLACIER_ENVIRONMENT_CONFIG,
} as const;
const environmentLabel = (type: MutationType) =>
  type === 'VOLCANO' ? '火山' : type === 'FOREST' ? '森林' : '冰川';
const mutationCardLabel = (mutationType: MutationType, type: CardType) =>
  mutationType === 'VOLCANO'
    ? volcanoCardLabel(type)
    : mutationType === 'FOREST'
      ? forestCardLabel(type)
      : glacierCardLabel(type);
const battleCardLabel = (card: Card) =>
  card.mutationType === 'VOLCANO'
    ? volcanoCardLabel(card.type)
    : card.mutationType === 'FOREST'
      ? forestCardLabel(card.type)
      : card.mutationType === 'GLACIER'
        ? glacierCardLabel(card.type)
      : cardLabel(card.type);

const buildVolcanoDamageLog = (damagingCards: Card[], volcanoBonus: number) => {
  if (volcanoBonus <= 0) return null;
  const volcanoCards = damagingCards.filter(card => card.mutationType === 'VOLCANO');

  if (volcanoCards.length === 1) {
    return `[火山异变] 附加伤害：+${Math.min(1, VOLCANO_ENVIRONMENT_CONFIG.maxMutationDamageBonusPerClash)}`;
  }

  if (volcanoCards.length > volcanoBonus) {
    return `[火山异变] 成功命中 ${volcanoCards.length} 张，附加伤害上限生效：+${volcanoBonus}`;
  }

  return `[火山异变] 附加伤害：+${volcanoBonus}`;
};

const CardIcon = ({ type, className }: { type: CardType; className?: string }) => {
  switch (type) {
    case 'ROCK':
      return <div className={`flex items-center justify-center font-bold ${className}`}>✊</div>;
    case 'PAPER':
      return <div className={`flex items-center justify-center font-bold ${className}`}>✋</div>;
    case 'SCISSORS':
      return <div className={`flex items-center justify-center font-bold ${className}`}>✌️</div>;
  }
};

const getCardBorderClass = (type: CardType) => {
  switch (type) {
    case 'ROCK': return 'border-b-rock';
    case 'PAPER': return 'border-b-paper';
    case 'SCISSORS': return 'border-b-scissors';
  }
};

export default function App() {
  const [deckOnMount] = useState(() => createDeck());

  const [state, setState] = useState<GameState>(() => ({
    playerHP: INITIAL_HP,
    aiHP: INITIAL_HP,
    playerHand: deckOnMount.slice(0, PLAYER_BASE_HAND_LIMIT),
    aiHand: deckOnMount.slice(PLAYER_BASE_HAND_LIMIT, PLAYER_BASE_HAND_LIMIT + AI_BASE_HAND_LIMIT),
    playerRole: 'HOME',
    aiRole: 'GUEST',
    phase: 'PLAYER_ATTACK',
    homePlayed: [],
    guestPlayed: [],
    lastAction: zhCN.logs.battleInitialized,
    winner: null,
    drawPile: deckOnMount.slice(PLAYER_BASE_HAND_LIMIT + AI_BASE_HAND_LIMIT),
    playerDiscardPile: [],
    aiDiscardPile: [],
    playerOfferingPile: [],
  }));

  const stateRef = useRef<GameState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const settlementTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const continueAfterMutationRef = useRef<(() => void) | null>(null);
  const completedClashCountRef = useRef(0);
  const environmentRouteIndexRef = useRef(0);
  const environmentRoundsRemainingRef = useRef(ENVIRONMENT_ROUTE_CONFIG.roundsPerEnvironment);
  const completedClashesSinceMutationRef = useRef(0);
  const claimedStageRewardStagesRef = useRef<Set<number>>(new Set());
  const claimedItemRewardStagesRef = useRef<Set<number>>(new Set());
  const enemyScorchMarksRef = useRef(0);
  const stageSessionIdRef = useRef(0);
  const battleFrozenRef = useRef(false);
  const clearSettlementTimers = useCallback(() => {
    settlementTimersRef.current.forEach(timer => clearTimeout(timer));
    settlementTimersRef.current = [];
  }, []);
  const scheduleSettlementTimer = useCallback((fn: () => void, delay: number) => {
    const sessionId = stageSessionIdRef.current;
    let timer: ReturnType<typeof setTimeout>;
    timer = setTimeout(() => {
      settlementTimersRef.current = settlementTimersRef.current.filter(item => item !== timer);
      if (stageSessionIdRef.current !== sessionId || battleFrozenRef.current) return;
      fn();
    }, delay);
    settlementTimersRef.current.push(timer);
    return timer;
  }, []);

  useEffect(() => () => {
    clearSettlementTimers();
  }, [clearSettlementTimers]);

  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [settlementSubPhase, setSettlementSubPhase] = useState<'resolving' | 'move-to-discard' | 'replenishing' | 'replenish-complete' | 'round-end' | null>(null);
  const [isBattleLogOpen, setIsBattleLogOpen] = useState(false);
  const [isDevPanelOpen, setIsDevPanelOpen] = useState(false);
  const [isDevDeityPickerOpen, setIsDevDeityPickerOpen] = useState(false);
  const [isExitLobbyDialogOpen, setIsExitLobbyDialogOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([
    zhCN.logs.battleInitialized,
    '[环境路线] 当前环境：火山',
    '[环境路线] 下一环境：森林',
  ]);
  
  const [isRerollMode, setIsRerollMode] = useState<boolean>(false);
  const [rerollSelectedCardId, setRerollSelectedCardId] = useState<string | null>(null);
  const [playerHasRerolledThisTurn, setPlayerHasRerolledThisTurn] = useState<boolean>(false);
  const [aiHasRerolledThisTurn, setAiHasRerolledThisTurn] = useState<boolean>(false);
  const [shortNotice, setShortNotice] = useState<string | null>(null);
  const [drawWarningPopUp, setDrawWarningPopUp] = useState<boolean>(false);
  const [activeDiscardModal, setActiveDiscardModal] = useState<'PLAYER' | 'AI' | null>(null);
  const [showDepletedNotification, setShowDepletedNotification] = useState<boolean>(false);
  const [hasLoggedDepletion, setHasLoggedDepletion] = useState<boolean>(false);
  const [resourceDepletedWinnerDetail, setResourceDepletedWinnerDetail] = useState<{ eng: string; chn: string } | null>(null);
  const [completedClashesSinceMutation, setCompletedClashesSinceMutation] = useState(0);
  const [environmentRouteIndex, setEnvironmentRouteIndex] = useState(0);
  const [environmentRoundsRemaining, setEnvironmentRoundsRemaining] = useState(ENVIRONMENT_ROUTE_CONFIG.roundsPerEnvironment);
  const [environmentSwitchNotice, setEnvironmentSwitchNotice] = useState<{ from: RoutedEnvironmentType; to: RoutedEnvironmentType; token: number } | null>(null);
  const [completedClashCount, setCompletedClashCount] = useState(0);
  const [mutationCandidates, setMutationCandidates] = useState<Card[]>([]);
  const [mutationPhaseNotice, setMutationPhaseNotice] = useState<string | null>(null);
  const [mutationEventPulse, setMutationEventPulse] = useState(false);
  const [mutationAnimation, setMutationAnimation] = useState<{ side: 'PLAYER' | 'AI'; cardId?: string; token: number } | null>(null);
  const [mutatedCardGlowIds, setMutatedCardGlowIds] = useState<Record<string, boolean>>({});
  const [maturedCardGlowIds, setMaturedCardGlowIds] = useState<Record<string, boolean>>({});
  const [playerMutationCountPulse, setPlayerMutationCountPulse] = useState(false);
  const [aiMutationCountPulse, setAiMutationCountPulse] = useState(false);
  const [resonanceAnimation, setResonanceAnimation] = useState<{ source: 'PLAYER' | 'AI'; target: 'PLAYER' | 'AI'; token: number } | null>(null);
  const [burnFeedback, setBurnFeedback] = useState<{ targets: Array<'PLAYER' | 'AI'>; token: number } | null>(null);
  const [forestRecoveryFeedback, setForestRecoveryFeedback] = useState<{
    targets: Array<'PLAYER' | 'AI'>;
    recoveryByTarget: Partial<Record<'PLAYER' | 'AI', number>>;
    symbiosisByTarget: Partial<Record<'PLAYER' | 'AI', boolean>>;
    token: number;
  } | null>(null);
  const [dewdropFeedback, setDewdropFeedback] = useState<{ type: 'gain' | 'heal'; amount: number; token: number } | null>(null);
  const [sproutFeedback, setSproutFeedback] = useState<{ success: boolean; token: number } | null>(null);
  const [antlerChargePickerOpen, setAntlerChargePickerOpen] = useState(false);
  const [antlerChargeFeedback, setAntlerChargeFeedback] = useState<{ hpCost: number; damage: number; isSurge: boolean; token: number } | null>(null);
  const [frostSigilPickerOpen, setFrostSigilPickerOpen] = useState(false);
  const [frostSigilFeedback, setFrostSigilFeedback] = useState<{ hitIndex: number; totalHits: number; token: number } | null>(null);
  const [glacierRecycleFeedback, setGlacierRecycleFeedback] = useState<{
    targets: Array<'PLAYER' | 'AI'>;
    echoByTarget?: Partial<Record<'PLAYER' | 'AI', boolean>>;
    token: number;
  } | null>(null);
  const [glacierEchoCandidates, setGlacierEchoCandidates] = useState<Card[]>([]);
  const continueAfterGlacierEchoRef = useRef<((selectedCardId?: string) => void) | null>(null);

  useEffect(() => {
    environmentRouteIndexRef.current = environmentRouteIndex;
  }, [environmentRouteIndex]);

  useEffect(() => {
    environmentRoundsRemainingRef.current = environmentRoundsRemaining;
  }, [environmentRoundsRemaining]);

  useEffect(() => {
    completedClashesSinceMutationRef.current = completedClashesSinceMutation;
  }, [completedClashesSinceMutation]);
  
  // Custom feedback states
  const [playerDiscardPrompt, setPlayerDiscardPrompt] = useState<string | null>(null);
  const [aiDiscardPrompt, setAiDiscardPrompt] = useState<string | null>(null);
  const [sharedDeckPrompt, setSharedDeckPrompt] = useState<string | null>(null);
  const [sharedDeckSubPrompt, setSharedDeckSubPrompt] = useState<string | null>(null);
  const [sharedDeckChangeAmount, setSharedDeckChangeAmount] = useState<string | null>(null);
  const [sharedDeckTransit, setSharedDeckTransit] = useState<string | null>(null);
  const [sharedDeckScale, setSharedDeckScale] = useState<boolean>(false);

  const triggerDeckFeedback = useCallback((title: string, sub: string, changeStr: string, transit: string | null = null) => {
    setSharedDeckPrompt(title);
    setSharedDeckSubPrompt(sub);
    setSharedDeckChangeAmount(changeStr);
    setSharedDeckTransit(transit);
    setSharedDeckScale(true);
    scheduleSettlementTimer(() => {
      setSharedDeckScale(false);
    }, 250);
    scheduleSettlementTimer(() => {
      setSharedDeckPrompt(null);
      setSharedDeckSubPrompt(null);
      setSharedDeckChangeAmount(null);
      setSharedDeckTransit(null);
    }, 2000);
  }, [scheduleSettlementTimer]);

  const noticeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [shakingCardIds, setShakingCardIds] = useState<Record<string, boolean>>({});
  const [defenseLimitNotice, setDefenseLimitNotice] = useState<number | null>(null);
  const defenseLimitNoticeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [clashResult, setClashResult] = useState<any>(null);
  const [playerHPFlash, setPlayerHPFlash] = useState<boolean>(false);
  const [aiHPFlash, setAiHPFlash] = useState<boolean>(false);
  const [playerHPShake, setPlayerHPShake] = useState<boolean>(false);
  const [aiHPShake, setAiHPShake] = useState<boolean>(false);

  const triggerCardShake = (id: string) => {
    setShakingCardIds(prev => ({ ...prev, [id]: true }));
    scheduleSettlementTimer(() => {
      setShakingCardIds(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    }, 300);
  };

  const triggerDefenseLimitNotice = (limit: number) => {
    if (defenseLimitNoticeTimerRef.current) {
      clearTimeout(defenseLimitNoticeTimerRef.current);
    }
    setDefenseLimitNotice(limit);
    defenseLimitNoticeTimerRef.current = setTimeout(() => {
      setDefenseLimitNotice(null);
    }, 1200);
  };

  const showShortNotice = (msg: string, duration = 2200) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setShortNotice(msg);
    noticeTimerRef.current = setTimeout(() => {
      setShortNotice(null);
    }, duration);
  };

  const absorbPlayerDamageWithShield = (incomingDamage: number) => {
    if (gameMode !== 'CHALLENGE' || incomingDamage <= 0) {
      return {
        hpDamage: incomingDamage,
        shieldAfter: playerShieldRef.current,
        absorbed: 0,
        logs: [] as string[],
      };
    }

    const shieldBefore = playerShieldRef.current;
    const absorbed = Math.min(shieldBefore, incomingDamage);
    const shieldAfter = shieldBefore - absorbed;
    const hpDamage = incomingDamage - absorbed;
    const logs: string[] = [];

    if (absorbed > 0) {
      logs.push(`[护盾] 吸收 ${absorbed} 点伤害：${shieldBefore} → ${shieldAfter}`);
      if (hpDamage > 0) {
        logs.push(`[伤害] 剩余 ${hpDamage} 点伤害扣除玩家生命`);
      }
    }

    return { hpDamage, shieldAfter, absorbed, logs };
  };

  const invalidateBattleSession = useCallback(() => {
    stageSessionIdRef.current += 1;
  }, []);

  const clearPendingBattleTimers = useCallback(() => {
    clearSettlementTimers();
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    if (defenseLimitNoticeTimerRef.current) {
      clearTimeout(defenseLimitNoticeTimerRef.current);
      defenseLimitNoticeTimerRef.current = null;
    }
  }, [clearSettlementTimers]);

  const clearTransientBattleVisuals = useCallback(() => {
    setActiveAnims([]);
    setMutationPhaseNotice(null);
    setMutationEventPulse(false);
    setMutationAnimation(null);
    setMutatedCardGlowIds({});
    setMaturedCardGlowIds({});
    setResonanceAnimation(null);
    setBurnFeedback(null);
    setForestRecoveryFeedback(null);
    setDewdropFeedback(null);
    setSproutFeedback(null);
    setAntlerChargeFeedback(null);
    setAntlerChargePickerOpen(false);
    setFrostSigilFeedback(null);
    setFrostSigilPickerOpen(false);
    setGlacierRecycleFeedback(null);
    setGlacierEchoCandidates([]);
    setScorchFeedback(null);
    setPlayerDiscardPrompt(null);
    setAiDiscardPrompt(null);
    setSharedDeckPrompt(null);
    setSharedDeckSubPrompt(null);
    setSharedDeckChangeAmount(null);
    setSharedDeckTransit(null);
    setSharedDeckScale(false);
    setDefenseLimitNotice(null);
    setShakingCardIds({});
    setShortNotice(null);
    setIsDevPanelOpen(false);
    setEnvironmentSwitchNotice(null);
    setChallengeStageNotice(null);
    setOfferingPickerCardId(null);
    continueAfterMutationRef.current = null;
    continueAfterGlacierEchoRef.current = null;
  }, []);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const [screen, setScreen] = useState<'HOME' | 'BATTLE'>('HOME');
  const [selectedProtocol, setSelectedProtocol] = useState<'QUICK' | 'TRAINING' | 'CHALLENGE' | null>(null);
  const [hasValidChallengeSave, setHasValidChallengeSave] = useState(() => hasChallengeRunSave());
  const [gameMode, setGameMode] = useState<GameMode>('QUICK');
  const [currentChallengeStage, setCurrentChallengeStage] = useState(1);
  const [faithState, setFaithState] = useState<FaithState>(() => createInitialFaithState());
  const [playerDewdrops, setPlayerDewdrops] = useState(0);
  const [playerFrostSigils, setPlayerFrostSigils] = useState(0);
  const [playerMaxHp, setPlayerMaxHp] = useState(CHALLENGE_REWARD_CONFIG.basePlayerMaxHp);
  const [playerShield, setPlayerShield] = useState(CHALLENGE_REWARD_CONFIG.basePlayerShield);
  const [playerHandLimit, setPlayerHandLimit] = useState(CHALLENGE_REWARD_CONFIG.basePlayerHandLimit);
  const [hasClaimedHandSlotReward, setHasClaimedHandSlotReward] = useState(false);
  const [offeringPickerCardId, setOfferingPickerCardId] = useState<string | null>(null);
  const [hasOfferedThisClash, setHasOfferedThisClash] = useState(false);
  const [hasUsedDeitySkillThisClash, setHasUsedDeitySkillThisClash] = useState(false);
  const [hasTriggeredCoreCombustionThisEnemy, setHasTriggeredCoreCombustionThisEnemy] = useState(false);
  const [hasTriggeredVerdantSurgeThisEnemy, setHasTriggeredVerdantSurgeThisEnemy] = useState(false);
  const [hasTriggeredBlizzardThisEnemy, setHasTriggeredBlizzardThisEnemy] = useState(false);
  const [bossPressure, setBossPressure] = useState(0);
  const [enemyScorchMarks, setEnemyScorchMarks] = useState(0);
  const [scorchFeedback, setScorchFeedback] = useState<{ type: 'mark' | 'fuel' | 'ember' | 'core' | 'combustion'; damage?: number; coreDamage?: number; token: number } | null>(null);
  const [selectedStageReward, setSelectedStageReward] = useState<StageRewardState>(null);
  const [selectedStageItemReward, setSelectedStageItemReward] = useState<StageItemRewardState>(null);
  const [challengeStageClear, setChallengeStageClear] = useState<{
    completedStage: number;
    nextStage: number;
    playerHP: number;
    retainedHandCount: number;
    mutatedCardCount: number;
  } | null>(null);
  const [challengeStageNotice, setChallengeStageNotice] = useState<{ stage: number; token: number } | null>(null);
  const [homeLogs, setHomeLogs] = useState<string[]>([
    zhCN.logs.battleEngineOnline,
    zhCN.logs.selectProtocol,
  ]);
  const [isMuted, setIsMuted] = useState(false);
  const homeLogContainerRef = useRef<HTMLDivElement>(null);
  const playerDewdropsRef = useRef(0);
  const playerFrostSigilsRef = useRef(0);
  const playerMaxHpRef = useRef(CHALLENGE_REWARD_CONFIG.basePlayerMaxHp);
  const playerShieldRef = useRef(CHALLENGE_REWARD_CONFIG.basePlayerShield);
  const playerHandLimitRef = useRef(CHALLENGE_REWARD_CONFIG.basePlayerHandLimit);
  const bossPressureRef = useRef(0);

  useEffect(() => {
    playerDewdropsRef.current = playerDewdrops;
  }, [playerDewdrops]);

  useEffect(() => {
    playerFrostSigilsRef.current = playerFrostSigils;
  }, [playerFrostSigils]);

  useEffect(() => {
    playerMaxHpRef.current = playerMaxHp;
  }, [playerMaxHp]);

  useEffect(() => {
    playerShieldRef.current = playerShield;
  }, [playerShield]);

  useEffect(() => {
    playerHandLimitRef.current = playerHandLimit;
  }, [playerHandLimit]);
  useEffect(() => {
    bossPressureRef.current = bossPressure;
  }, [bossPressure]);

  useEffect(() => {
    if (homeLogContainerRef.current) {
      setTimeout(() => {
        if (homeLogContainerRef.current) {
          homeLogContainerRef.current.scrollTop = homeLogContainerRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [homeLogs]);

  // --- ANIMATIONS STATE & UTILS ---
  const [activeAnims, setActiveAnims] = useState<any[]>([]);

  const addAnimation = useCallback((type: 'DRAW' | 'DISCARD' | 'SHUFFLE' | 'DRAW_PLAYER' | 'DRAW_AI', startX: number, startY: number, endX: number, endY: number, cardType?: CardType) => {
    setActiveAnims(prev => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 11),
        type,
        startX,
        startY,
        endX,
        endY,
        cardType,
      },
    ]);
  }, []);

  const removeAnimation = useCallback((id: string) => {
    setActiveAnims(prev => prev.filter(anim => anim.id !== id));
  }, []);

  // Sync logs and support line breaks
  useEffect(() => {
    if (state.lastAction) {
      if (state.lastAction.includes('系统重启') || state.lastAction.includes('任务开始') || state.lastAction === '游戏开始，你是主场') {
        const lines = state.lastAction.split('\n').map(l => l.trim()).filter(Boolean);
        setLogs(lines);
      } else {
        const lines = state.lastAction.split('\n').map(l => l.trim()).filter(Boolean);
        setLogs(prev => {
          const nextLogs = [...prev];
          lines.forEach(line => {
            if (nextLogs[nextLogs.length - 1] !== line) {
              nextLogs.push(line);
            }
          });
          return nextLogs;
        });
      }
    }
  }, [state.lastAction]);

  useEffect(() => {
    if (logContainerRef.current) {
      // Small timeout to ensure DOM update is rendered before scrolling
      setTimeout(() => {
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [logs, isBattleLogOpen]);

  useEffect(() => {
    if (!isBattleLogOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsBattleLogOpen(false);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isBattleLogOpen]);

  useEffect(() => {
    if (!isExitLobbyDialogOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExitLobbyDialogOpen(false);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isExitLobbyDialogOpen]);

  useEffect(() => {
    if (!isDevDeityPickerOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDevDeityPickerOpen(false);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isDevDeityPickerOpen]);

  // Player tactical card drawer and AI deck generator from shared deck
  const replenishHandsWithState = useCallback((
    pHand: Card[],
    aHand: Card[],
    pDraw: Card[]
  ) => {
    const newPHand = [...pHand];
    const newAHand = [...aHand];
    let tempDraw = [...pDraw];
    const logEntries: string[] = [];

    // Player draws up to Math.min(2, player hand limit - current hand size)
    const pDrawnCards: Card[] = [];
    const currentPlayerHandLimit = gameMode === 'CHALLENGE' ? playerHandLimitRef.current : PLAYER_BASE_HAND_LIMIT;
    const pDrawCount = Math.min(2, Math.max(0, currentPlayerHandLimit - newPHand.length));

    for (let i = 0; i < pDrawCount; i++) {
      if (tempDraw.length > 0) {
        const drawn = tempDraw.shift()!;
        newPHand.push(drawn);
        pDrawnCards.push(drawn);
      }
    }

    if (pDrawCount > 0 && pDrawnCards.length > 0) {
      logEntries.push(zhCN.logs.playerDraw(pDrawnCards.length));
      logEntries.push(zhCN.logs.sharedDeckChange(pDraw.length, tempDraw.length));
    }

    // AI draws up to Math.min(2, AI_BASE_HAND_LIMIT - current hand size)
    const aDrawnCards: Card[] = [];
    const aDrawCount = Math.min(2, Math.max(0, AI_BASE_HAND_LIMIT - newAHand.length));

    for (let i = 0; i < aDrawCount; i++) {
      if (tempDraw.length > 0) {
        const drawn = tempDraw.shift()!;
        newAHand.push(drawn);
        aDrawnCards.push(drawn);
      }
    }

    if (aDrawCount > 0 && aDrawnCards.length > 0) {
      logEntries.push(zhCN.logs.aiDraw(aDrawnCards.length));
      logEntries.push(zhCN.logs.sharedDeckChange(pDraw.length - pDrawnCards.length, tempDraw.length));
    }

    return {
      playerHand: newPHand,
      aiHand: newAHand,
      drawPile: tempDraw,
      pDrawnCards,
      aDrawnCards,
      logEntries,
    };
  }, [gameMode]);

  const recycleSharedDeckIfPossible = useCallback((snapshot: GameState) => {
    const playerDiscardCount = snapshot.playerDiscardPile.length;
    const aiDiscardCount = snapshot.aiDiscardPile.length;
    const offeringCount = snapshot.playerOfferingPile.length;
    if (playerDiscardCount + aiDiscardCount + offeringCount <= 0) {
      return {
        state: snapshot,
        recycled: false,
        logs: ['[公共牌库] 没有可回收卡牌，进入最终交锋'],
      };
    }

    const recycleResult = recycleDiscardPilesIntoSharedDeck({
      playerDiscardPile: snapshot.playerDiscardPile,
      aiDiscardPile: snapshot.aiDiscardPile,
      playerOfferingPile: snapshot.playerOfferingPile,
    });
    const nextState = {
      ...snapshot,
      drawPile: [...snapshot.drawPile, ...recycleResult.recycledDeck],
      playerDiscardPile: [],
      aiDiscardPile: [],
      playerOfferingPile: [],
    };

    return {
      state: nextState,
      recycled: true,
      logs: [
        '[公共牌库] 牌库已耗尽，开始回收弃牌区',
        `[公共牌库] 回收玩家弃牌区：${playerDiscardCount} 张`,
        `[公共牌库] 回收对手弃牌区：${aiDiscardCount} 张`,
        `[公共牌库] 回收奉纳区：${offeringCount} 张`,
        ...(offeringCount > 0 ? ['[公共牌库] 奉纳异变牌已恢复为普通牌'] : []),
        `[公共牌库] 异变牌恢复为普通牌：${recycleResult.normalizedMutationCount} 张`,
        '[公共牌库] 已重新洗牌',
        `[公共牌库] 当前剩余：${nextState.drawPile.length} 张`,
      ],
    };
  }, []);

  const tryRecycleSharedDeckState = useCallback((snapshot: GameState) => {
    const recycle = recycleSharedDeckIfPossible(snapshot);
    if (recycle.logs.length > 0) {
      setLogs(prev => [...prev, ...recycle.logs]);
    }
    if (recycle.recycled) {
      triggerDeckFeedback('公共牌库已耗尽', '弃牌回收完成，公共牌库已重新洗牌', `+${recycle.state.drawPile.length}`, `0 → ${recycle.state.drawPile.length}`);
    }
    return recycle;
  }, [recycleSharedDeckIfPossible, triggerDeckFeedback]);

  const resetGame = (mode: GameMode = gameMode) => {
    invalidateBattleSession();
    battleFrozenRef.current = false;
    clearPendingBattleTimers();
    clearTransientBattleVisuals();
    const modeConfig = GAME_MODE_CONFIG[mode];
    const initialEnvironment = modeConfig.environmentRoute[0];
    const initialAiHP = mode === 'CHALLENGE' ? getChallengeStageConfig(1).aiHp : INITIAL_HP;
    const newDeck = createDeck();
    const nextState: GameState = {
      playerHP: INITIAL_HP,
      aiHP: initialAiHP,
      playerHand: newDeck.slice(0, PLAYER_BASE_HAND_LIMIT),
      aiHand: newDeck.slice(PLAYER_BASE_HAND_LIMIT, PLAYER_BASE_HAND_LIMIT + AI_BASE_HAND_LIMIT),
      playerRole: 'HOME',
      aiRole: 'GUEST',
      phase: 'PLAYER_ATTACK',
      homePlayed: [],
      guestPlayed: [],
      lastAction: zhCN.logs.reset,
      winner: null,
      drawPile: newDeck.slice(PLAYER_BASE_HAND_LIMIT + AI_BASE_HAND_LIMIT),
      playerDiscardPile: [],
      aiDiscardPile: [],
      playerOfferingPile: [],
    };
    stateRef.current = nextState;
    setGameMode(mode);
    setCurrentChallengeStage(1);
    claimedStageRewardStagesRef.current.clear();
    claimedItemRewardStagesRef.current.clear();
    setFaithState(createInitialFaithState());
    playerDewdropsRef.current = 0;
    setPlayerDewdrops(0);
    playerFrostSigilsRef.current = 0;
    setPlayerFrostSigils(0);
    playerMaxHpRef.current = CHALLENGE_REWARD_CONFIG.basePlayerMaxHp;
    playerShieldRef.current = CHALLENGE_REWARD_CONFIG.basePlayerShield;
    playerHandLimitRef.current = CHALLENGE_REWARD_CONFIG.basePlayerHandLimit;
    setPlayerMaxHp(CHALLENGE_REWARD_CONFIG.basePlayerMaxHp);
    setPlayerShield(CHALLENGE_REWARD_CONFIG.basePlayerShield);
    setPlayerHandLimit(CHALLENGE_REWARD_CONFIG.basePlayerHandLimit);
    setHasClaimedHandSlotReward(false);
    setOfferingPickerCardId(null);
    setHasOfferedThisClash(false);
    setHasUsedDeitySkillThisClash(false);
    setHasTriggeredCoreCombustionThisEnemy(false);
    setHasTriggeredVerdantSurgeThisEnemy(false);
    setHasTriggeredBlizzardThisEnemy(false);
    bossPressureRef.current = 0;
    setBossPressure(0);
    enemyScorchMarksRef.current = 0;
    setEnemyScorchMarks(0);
    setScorchFeedback(null);
    setSelectedStageReward(null);
    setSelectedStageItemReward(null);
    setChallengeStageClear(null);
    setChallengeStageNotice(null);
    setState(nextState);
    setSelectedCards([]);
    setClashResult(null);
    setIsProcessing(false);
    setSettlementSubPhase(null);
    setIsRerollMode(false);
    setRerollSelectedCardId(null);
    setPlayerHasRerolledThisTurn(false);
    setAiHasRerolledThisTurn(false);
    setDrawWarningPopUp(false);
    setDefenseLimitNotice(null);
    setShakingCardIds({});
    setActiveDiscardModal(null);
    setShowDepletedNotification(false);
    setHasLoggedDepletion(false);
    setResourceDepletedWinnerDetail(null);
    setCompletedClashesSinceMutation(0);
    completedClashesSinceMutationRef.current = 0;
    setEnvironmentRouteIndex(0);
    environmentRouteIndexRef.current = 0;
    const resetRoundsPerEnvironment = 'roundsPerEnvironment' in modeConfig
      ? modeConfig.roundsPerEnvironment
      : ENVIRONMENT_ROUTE_CONFIG.roundsPerEnvironment;
    setEnvironmentRoundsRemaining(resetRoundsPerEnvironment);
    environmentRoundsRemainingRef.current = resetRoundsPerEnvironment;
    setEnvironmentSwitchNotice(null);
    setCompletedClashCount(0);
    completedClashCountRef.current = 0;
    setMutationCandidates([]);
    setMutationPhaseNotice(null);
    setMutationEventPulse(false);
    setMutationAnimation(null);
    setMutatedCardGlowIds({});
    setMaturedCardGlowIds({});
    setPlayerMutationCountPulse(false);
    setAiMutationCountPulse(false);
    setResonanceAnimation(null);
    setBurnFeedback(null);
    setForestRecoveryFeedback(null);
    setDewdropFeedback(null);
    setSproutFeedback(null);
    setAntlerChargeFeedback(null);
    setAntlerChargePickerOpen(false);
    setFrostSigilFeedback(null);
    setFrostSigilPickerOpen(false);
    setGlacierRecycleFeedback(null);
    setGlacierEchoCandidates([]);
    setScorchFeedback(null);
    continueAfterGlacierEchoRef.current = null;
    continueAfterMutationRef.current = null;
    setPlayerDiscardPrompt(null);
    setAiDiscardPrompt(null);
    setSharedDeckPrompt(null);
    setSharedDeckSubPrompt(null);
    setSharedDeckChangeAmount(null);
    setSharedDeckTransit(null);
    setSharedDeckScale(false);
    setActiveAnims([]);
    setIsDevPanelOpen(false);
    setLogs(mode === 'QUICK'
      ? [
          zhCN.logs.reset,
          `[模式] 当前模式：${modeConfig.name}`,
          `[环境事件] 当前环境：${environmentLabel(initialEnvironment)}`,
          `[环境事件] 下一次感染：${modeConfig.mutationIntervalRounds} 轮后`,
        ]
      : [
          zhCN.logs.reset,
          `[模式] 当前模式：${modeConfig.name}`,
          `[挑战模式] 进入第 1 / ${CHALLENGE_STAGE_CONFIG.totalStages} 关`,
          `[对手] 当前生命：${initialAiHP} / ${initialAiHP}`,
          `[对手] 当前 AI 类型：${getChallengeAiStageConfig(1).name}`,
          '[环境路线] 火山 → 森林 → 冰川',
          `[环境路线] 当前环境：${environmentLabel(initialEnvironment)}`,
          `[环境事件] 下一次感染：${modeConfig.mutationIntervalRounds} 轮后`,
        ]
    );
  };

  const returnToLobby = () => {
    resetGame();
    setScreen('HOME');
    setSelectedProtocol(null);
  };

  const createChallengeRunSnapshot = (): ChallengeRunSave => ({
      schemaVersion: CHALLENGE_RUN_SAVE_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      gameMode,
      challengeStage: currentChallengeStage,
      state: stateRef.current,
      logs,
      challengeStageClear,
      faithState,
      playerDewdrops: playerDewdropsRef.current,
      playerFrostSigils: playerFrostSigilsRef.current,
      playerMaxHp: playerMaxHpRef.current,
      playerShield: playerShieldRef.current,
      playerHandLimit: playerHandLimitRef.current,
      hasClaimedHandSlotReward,
      selectedStageReward,
      selectedStageItemReward,
      claimedStageRewardStages: Array.from(claimedStageRewardStagesRef.current),
      claimedItemRewardStages: Array.from(claimedItemRewardStagesRef.current),
      completedClashCount: completedClashCountRef.current,
      completedClashesSinceMutation: completedClashesSinceMutationRef.current,
      environmentRouteIndex: environmentRouteIndexRef.current,
      environmentRoundsRemaining: environmentRoundsRemainingRef.current,
      enemyScorchMarks: enemyScorchMarksRef.current,
      bossPressure: bossPressureRef.current,
      hasTriggeredCoreCombustionThisEnemy,
      hasTriggeredVerdantSurgeThisEnemy,
      hasTriggeredBlizzardThisEnemy,
  });

  const saveCurrentRunProgress = () => {
    if (gameMode !== 'CHALLENGE') return null;
    const snapshot = createChallengeRunSnapshot();
    saveChallengeRun(snapshot);
    setHasValidChallengeSave(true);
    return snapshot;
  };

  const restoreChallengeRun = (save: ChallengeRunSave) => {
    invalidateBattleSession();
    battleFrozenRef.current = false;
    clearPendingBattleTimers();
    clearTransientBattleVisuals();

    stateRef.current = save.state as GameState;
    setState(save.state as GameState);
    setLogs(save.logs);
    setChallengeStageClear(save.challengeStageClear as typeof challengeStageClear);
    setGameMode('CHALLENGE');
    setCurrentChallengeStage(save.challengeStage);
    setFaithState(save.faithState as FaithState);
    playerDewdropsRef.current = save.playerDewdrops;
    setPlayerDewdrops(save.playerDewdrops);
    playerFrostSigilsRef.current = save.playerFrostSigils;
    setPlayerFrostSigils(save.playerFrostSigils);
    playerMaxHpRef.current = save.playerMaxHp;
    setPlayerMaxHp(save.playerMaxHp);
    playerShieldRef.current = save.playerShield;
    setPlayerShield(save.playerShield);
    playerHandLimitRef.current = save.playerHandLimit;
    setPlayerHandLimit(save.playerHandLimit);
    setHasClaimedHandSlotReward(save.hasClaimedHandSlotReward);
    setSelectedStageReward(save.selectedStageReward as StageRewardState);
    setSelectedStageItemReward(save.selectedStageItemReward as StageItemRewardState);
    claimedStageRewardStagesRef.current = new Set(save.claimedStageRewardStages);
    claimedItemRewardStagesRef.current = new Set(save.claimedItemRewardStages);
    completedClashCountRef.current = save.completedClashCount;
    setCompletedClashCount(save.completedClashCount);
    completedClashesSinceMutationRef.current = save.completedClashesSinceMutation;
    setCompletedClashesSinceMutation(save.completedClashesSinceMutation);
    environmentRouteIndexRef.current = save.environmentRouteIndex;
    setEnvironmentRouteIndex(save.environmentRouteIndex);
    environmentRoundsRemainingRef.current = save.environmentRoundsRemaining;
    setEnvironmentRoundsRemaining(save.environmentRoundsRemaining);
    enemyScorchMarksRef.current = save.enemyScorchMarks;
    setEnemyScorchMarks(save.enemyScorchMarks);
    bossPressureRef.current = save.bossPressure;
    setBossPressure(save.bossPressure);
    setHasTriggeredCoreCombustionThisEnemy(save.hasTriggeredCoreCombustionThisEnemy);
    setHasTriggeredVerdantSurgeThisEnemy(save.hasTriggeredVerdantSurgeThisEnemy);
    setHasTriggeredBlizzardThisEnemy(save.hasTriggeredBlizzardThisEnemy);

    setSelectedCards([]);
    setClashResult(null);
    setIsProcessing(false);
    setSettlementSubPhase(null);
    setIsRerollMode(false);
    setRerollSelectedCardId(null);
    setOfferingPickerCardId(null);
    setActiveDiscardModal(null);
    setGlacierEchoCandidates([]);
    continueAfterGlacierEchoRef.current = null;
    continueAfterMutationRef.current = null;
    setIsDevPanelOpen(false);
    setIsExitLobbyDialogOpen(false);
    setLogs(prev => [...prev, '[存档] 已恢复挑战进度']);
    setScreen('BATTLE');
    setSelectedProtocol('CHALLENGE');
  };

  const exitBattleToLobby = (preserveSave: boolean) => {
    if (preserveSave && gameMode === 'CHALLENGE') {
      saveCurrentRunProgress();
    } else if (gameMode === 'CHALLENGE') {
      clearChallengeRun();
      setHasValidChallengeSave(false);
    }

    setIsExitLobbyDialogOpen(false);
    resetGame(gameMode);
    setScreen('HOME');
    setSelectedProtocol(null);
  };

  const startNewChallengeRun = () => {
    clearChallengeRun();
    setHasValidChallengeSave(false);
    setHomeLogs(prev => [
      ...prev,
      zhCN.logs.initializingBattlefield,
    ]);
    setTimeout(() => {
      resetGame('CHALLENGE');
      setScreen('BATTLE');
    }, 800);
  };

  const continueSavedChallengeRun = () => {
    const save = loadChallengeRun();
    if (!save) {
      setHasValidChallengeSave(false);
      setHomeLogs(prev => [...prev, '[存档] 暂无可继续的挑战存档']);
      return;
    }

    setHasValidChallengeSave(true);
    restoreChallengeRun(save);
  };

  const showMutationPhaseNotice = useCallback((message: string, duration = 700) => {
    setMutationPhaseNotice(message);
    scheduleSettlementTimer(() => {
      setMutationPhaseNotice(null);
    }, duration);
  }, [scheduleSettlementTimer]);

  const pulseMutationEvent = useCallback(() => {
    setMutationEventPulse(true);
    scheduleSettlementTimer(() => {
      setMutationEventPulse(false);
    }, 780);
  }, [scheduleSettlementTimer]);

  const currentModeConfig = GAME_MODE_CONFIG[gameMode];
  const currentChallengeStageConfig = getChallengeStageConfig(currentChallengeStage);
  const currentAiMaxHP = gameMode === 'CHALLENGE' ? currentChallengeStageConfig.aiHp : INITIAL_HP;
  const currentBossPressureConfig = 'bossPressureEnabled' in currentChallengeStageConfig
    ? currentChallengeStageConfig
    : null;
  const isBossPressureActive = gameMode === 'CHALLENGE' && currentBossPressureConfig?.bossPressureEnabled === true;
  const bossPressureThreshold = currentBossPressureConfig?.bossPressureThreshold ?? 0;
  const bossPressureBonusDamage = currentBossPressureConfig?.bossPressureBonusDamage ?? 0;
  const currentEnvironmentRoute = currentModeConfig.environmentRoute;
  const mutationLimit = currentModeConfig.mutationLimit;
  const mutationIntervalRounds = currentModeConfig.mutationIntervalRounds;
  const roundsPerEnvironment = 'roundsPerEnvironment' in currentModeConfig
    ? currentModeConfig.roundsPerEnvironment
    : ENVIRONMENT_ROUTE_CONFIG.roundsPerEnvironment;
  const activeEnvironmentType = currentEnvironmentRoute[environmentRouteIndex % currentEnvironmentRoute.length];
  const activeEnvironmentConfig = ENVIRONMENT_CONFIG_BY_ID[activeEnvironmentType];
  const nextEnvironmentType = currentEnvironmentRoute[(environmentRouteIndex + 1) % currentEnvironmentRoute.length];
  const nextEnvironmentConfig = ENVIRONMENT_CONFIG_BY_ID[nextEnvironmentType];
  const upcomingEnvironmentType = currentEnvironmentRoute[(environmentRouteIndex + 2) % currentEnvironmentRoute.length];
  const upcomingEnvironmentConfig = ENVIRONMENT_CONFIG_BY_ID[upcomingEnvironmentType];
  const activeMutationType = activeEnvironmentType as unknown as MutationType;
  const activeMutationLabel = environmentLabel(activeMutationType);
  const isVolcanoEnvironment = activeMutationType === 'VOLCANO';
  const isForestEnvironment = activeMutationType === 'FOREST';
  const isGlacierEnvironment = activeMutationType === 'GLACIER';
  const activeMutationCardLabel = (type: CardType) => mutationCardLabel(activeMutationType, type);
  const getActiveMutationCandidates = (hand: Card[]) =>
    activeMutationType === 'VOLCANO'
      ? getMutationCandidates(hand)
      : activeMutationType === 'GLACIER'
        ? getGlacierMutationCandidates(hand)
        : getForestMutationCandidates(hand);
  const playerVolcanoMutationCount = state.playerHand.filter(card => card.mutationType === 'VOLCANO').length;
  const playerForestMutationCount = state.playerHand.filter(card => card.mutationType === 'FOREST').length;
  const playerGlacierMutationCount = state.playerHand.filter(card => card.mutationType === 'GLACIER').length;

  const switchToNextEnvironmentIfNeeded = useCallback(() => {
    if (currentEnvironmentRoute.length <= 1) return;

    const remaining = environmentRoundsRemainingRef.current;
    if (remaining > 0 || stateRef.current.drawPile.length <= 0) return;

    const currentIndex = environmentRouteIndexRef.current;
    const from = currentEnvironmentRoute[currentIndex % currentEnvironmentRoute.length];
    const nextIndex = (currentIndex + 1) % currentEnvironmentRoute.length;
    const to = currentEnvironmentRoute[nextIndex];

    environmentRouteIndexRef.current = nextIndex;
    environmentRoundsRemainingRef.current = roundsPerEnvironment;
    completedClashesSinceMutationRef.current = 0;
    setEnvironmentRouteIndex(nextIndex);
    setEnvironmentRoundsRemaining(roundsPerEnvironment);
    setCompletedClashesSinceMutation(0);
    setEnvironmentSwitchNotice({ from, to, token: Date.now() });
    setLogs(prev => [
      ...prev,
      `[环境切换] ${environmentLabel(from)} → ${environmentLabel(to)}`,
      `[环境路线] 当前环境：${environmentLabel(to)}`,
      `[环境路线] 下一环境：${environmentLabel(currentEnvironmentRoute[(nextIndex + 1) % currentEnvironmentRoute.length])}`,
    ]);
    showMutationPhaseNotice(`环境切换：${ENVIRONMENT_CONFIG_BY_ID[from].icon} ${environmentLabel(from)} → ${ENVIRONMENT_CONFIG_BY_ID[to].icon} ${environmentLabel(to)}`, 850);
    scheduleSettlementTimer(() => {
      setEnvironmentSwitchNotice(null);
    }, 900);
  }, [currentEnvironmentRoute, roundsPerEnvironment, scheduleSettlementTimer, showMutationPhaseNotice]);

  const enterChallengeStageClear = useCallback((snapshot: GameState) => {
    if (gameMode !== 'CHALLENGE' || currentChallengeStage >= CHALLENGE_STAGE_CONFIG.totalStages) return false;

    invalidateBattleSession();
    battleFrozenRef.current = true;
    clearPendingBattleTimers();
    clearTransientBattleVisuals();

    const frozenState: GameState = {
      ...snapshot,
      aiHP: 0,
      aiHand: [],
      aiDiscardPile: [...snapshot.aiDiscardPile, ...snapshot.aiHand],
      phase: 'CHALLENGE_STAGE_CLEAR',
      homePlayed: [],
      guestPlayed: [],
      winner: null,
    };
    stateRef.current = frozenState;
    enemyScorchMarksRef.current = 0;
    setEnemyScorchMarks(0);
    setScorchFeedback(null);
    setHasTriggeredCoreCombustionThisEnemy(false);
    setHasTriggeredVerdantSurgeThisEnemy(false);
    setHasTriggeredBlizzardThisEnemy(false);
    bossPressureRef.current = 0;
    setBossPressure(0);
    setState(frozenState);
    setHasUsedDeitySkillThisClash(false);
    setChallengeStageClear({
      completedStage: currentChallengeStage,
      nextStage: currentChallengeStage + 1,
      playerHP: snapshot.playerHP,
      retainedHandCount: snapshot.playerHand.length,
      mutatedCardCount: countAllMutatedCards(snapshot.playerHand),
    });
    setLogs(prev => [
      ...prev,
      `[挑战模式] 第 ${currentChallengeStage} 关完成`,
      '[挑战模式] 关卡结算已冻结，等待进入下一关',
    ]);
    setIsProcessing(false);
    setSettlementSubPhase(null);
    setClashResult(null);
    setLogs(prev => [...prev, '[系统] 当前战斗流程已冻结']);
    return true;
  }, [clearPendingBattleTimers, clearTransientBattleVisuals, currentChallengeStage, gameMode, invalidateBattleSession]);

  const proceedToNextChallengeStage = useCallback(() => {
    if (!challengeStageClear) return;
    const requiresFaithReward = challengeStageClear.completedStage <= 2;
    if (requiresFaithReward && selectedStageReward?.stage !== challengeStageClear.completedStage) {
      showShortNotice('请先选择一项神明赐福');
      return;
    }
    const requiresItemReward = isItemRewardStage(challengeStageClear.completedStage);
    if (requiresItemReward && selectedStageItemReward?.stage !== challengeStageClear.completedStage) {
      showShortNotice('请先选择一项战利品');
      return;
    }

    invalidateBattleSession();
    clearPendingBattleTimers();
    clearTransientBattleVisuals();
    const snapshot = stateRef.current;
    if (snapshot.playerHP <= 0 || challengeStageClear.playerHP <= 0) {
      battleFrozenRef.current = true;
      const failedState: GameState = {
        ...snapshot,
        phase: 'GAME_OVER',
        winner: 'AI',
      };
      stateRef.current = failedState;
      setState(failedState);
      setChallengeStageClear(null);
      setSelectedStageReward(null);
      setLogs(prev => [...prev, '[挑战模式] 玩家生命值已归零，挑战失败']);
      setIsProcessing(false);
      setSettlementSubPhase(null);
      setClashResult(null);
      return;
    }
    battleFrozenRef.current = false;
    let deckSnapshot = snapshot;
    const nextPlayerHand = [...deckSnapshot.playerHand];
    const playerStageNeed = Math.max(0, playerHandLimitRef.current - nextPlayerHand.length);
    for (let i = 0; i < playerStageNeed; i += 1) {
      if (deckSnapshot.drawPile.length <= 0) {
        const recycle = tryRecycleSharedDeckState(deckSnapshot);
        deckSnapshot = recycle.state;
        if (!recycle.recycled || deckSnapshot.drawPile.length <= 0) break;
      }
      const [drawnCard, ...remainingDeck] = deckSnapshot.drawPile;
      nextPlayerHand.push(drawnCard);
      deckSnapshot = {
        ...deckSnapshot,
        drawPile: remainingDeck,
      };
    }
    const nextAiHand: Card[] = [];
    for (let i = 0; i < AI_BASE_HAND_LIMIT; i += 1) {
      if (deckSnapshot.drawPile.length <= 0) {
        const recycle = tryRecycleSharedDeckState(deckSnapshot);
        deckSnapshot = recycle.state;
        if (!recycle.recycled || deckSnapshot.drawPile.length <= 0) break;
      }
      const [drawnCard, ...remainingDeck] = deckSnapshot.drawPile;
      nextAiHand.push(drawnCard);
      deckSnapshot = {
        ...deckSnapshot,
        drawPile: remainingDeck,
      };
    }
    const nextDrawPile = deckSnapshot.drawPile;
    const nextStage = challengeStageClear.nextStage;
    const nextStageConfig = getChallengeStageConfig(nextStage);
    const nextAiHP = nextStageConfig.aiHp;
    const nextState: GameState = {
      ...deckSnapshot,
      aiHP: nextAiHP,
      playerHand: nextPlayerHand,
      aiHand: nextAiHand,
      drawPile: nextDrawPile,
      homePlayed: [],
      guestPlayed: [],
      winner: null,
      phase: snapshot.playerRole === 'HOME' ? 'PLAYER_ATTACK' : 'AI_ATTACK',
      lastAction: `[挑战模式] 进入第 ${nextStage} / ${CHALLENGE_STAGE_CONFIG.totalStages} 关\n[对手] 当前生命：${nextAiHP} / ${nextAiHP}\n[对手] 新的对手已进入战场\n[对手] 初始抽取 ${AI_BASE_HAND_LIMIT} 张卡牌`,
    };

    stateRef.current = nextState;
    setState(nextState);
    setCurrentChallengeStage(nextStage);
    setChallengeStageClear(null);
    setSelectedCards([]);
    setHasOfferedThisClash(false);
    setHasUsedDeitySkillThisClash(false);
    setHasTriggeredCoreCombustionThisEnemy(false);
    setHasTriggeredVerdantSurgeThisEnemy(false);
    setHasTriggeredBlizzardThisEnemy(false);
    bossPressureRef.current = 0;
    setBossPressure(0);
    enemyScorchMarksRef.current = 0;
    setEnemyScorchMarks(0);
    setScorchFeedback(null);
    setSelectedStageReward(null);
    setSelectedStageItemReward(null);
    setIsProcessing(false);
    setSettlementSubPhase(null);
    setClashResult(null);
    setGlacierEchoCandidates([]);
    continueAfterGlacierEchoRef.current = null;
    setChallengeStageNotice({ stage: nextStage, token: Date.now() });
    setLogs(prev => [...prev, '[系统] 已清理上一关残留任务']);
    setLogs(prev => [
      ...prev,
      `[公共牌库] 新关卡剩余卡牌数量：${nextDrawPile.length}`,
      `[挑战模式] 进入第 ${nextStage} / ${CHALLENGE_STAGE_CONFIG.totalStages} 关`,
      `[对手] 当前生命：${nextAiHP} / ${nextAiHP}`,
      `[对手] 当前 AI 类型：${getChallengeAiStageConfig(nextStage).name}`,
      '[对手] 新的对手已进入战场',
      `[对手] 初始抽取 ${AI_BASE_HAND_LIMIT} 张卡牌`,
    ]);
    showMutationPhaseNotice(`第 ${nextStage} 关：新的对手已进入战场`, 850);
    scheduleSettlementTimer(() => {
      setChallengeStageNotice(null);
    }, 900);
  }, [challengeStageClear, clearPendingBattleTimers, clearTransientBattleVisuals, invalidateBattleSession, scheduleSettlementTimer, selectedStageItemReward, selectedStageReward, showMutationPhaseNotice, tryRecycleSharedDeckState]);

  const claimStageFaithReward = (deityType: DeityType) => {
    if (gameMode !== 'CHALLENGE' || !challengeStageClear) return;
    const completedStage = challengeStageClear.completedStage;
    if (completedStage > 2 || selectedStageReward?.stage === completedStage || claimedStageRewardStagesRef.current.has(completedStage)) return;

    const deity = DEITY_CONFIG[deityType];
    const currentFaith = faithState[deityType];
    const faithBefore = currentFaith.faith;
    const levelBefore = currentFaith.level;
    const faithAfter = faithBefore + 1;
    const levelAfter = getFaithLevel(faithAfter);

    setFaithState(prev => ({
      ...prev,
      [deityType]: {
        faith: faithAfter,
        level: levelAfter,
      },
    }));
    setSelectedStageReward({
      stage: completedStage,
      deityType,
    });
    claimedStageRewardStagesRef.current.add(completedStage);
    showShortNotice(
      levelAfter > levelBefore
        ? `${deity.icon} ${deity.name}升级\nLv.${levelBefore} → Lv.${levelAfter}`
        : `${deity.icon} ${deity.name}信仰 +1`,
      900
    );
    setLogs(prev => [
      ...prev,
      `[奖励] 第 ${completedStage} 关完成，获得神明赐福`,
      `[信仰] ${deity.name}信仰：${faithBefore} → ${faithAfter}`,
      ...(levelAfter > levelBefore
        ? [`[神明] ${deity.name}升级：Lv.${levelBefore} → Lv.${levelAfter}`]
        : []),
    ]);
  };

  const claimStageItemReward = (rewardId: StageItemRewardId) => {
    if (gameMode !== 'CHALLENGE' || !challengeStageClear) return;
    const completedStage = challengeStageClear.completedStage;
    if (!isItemRewardStage(completedStage)) return;
    if (selectedStageItemReward?.stage === completedStage || claimedItemRewardStagesRef.current.has(completedStage)) return;
    const reward = STAGE_ITEM_REWARDS.find(item => item.id === rewardId);
    if (!reward) return;

    if (rewardId === 'HAND_SLOT' && hasClaimedHandSlotReward) {
      showShortNotice('本轮挑战已获得手牌扩容');
      return;
    }

    const rewardLogs = [`[奖励] 获得“${reward.name}”`];

    if (rewardId === 'HAND_SLOT') {
      const before = playerHandLimitRef.current;
      const after = before + CHALLENGE_REWARD_CONFIG.handSlotBonus;
      playerHandLimitRef.current = after;
      setPlayerHandLimit(after);
      setHasClaimedHandSlotReward(true);
      rewardLogs.push(`[成长] 玩家手牌槽位：${before} → ${after}`);
    } else if (rewardId === 'MAX_HP') {
      const maxHpBefore = playerMaxHpRef.current;
      const maxHpAfter = maxHpBefore + CHALLENGE_REWARD_CONFIG.maxHpBonus;
      const hpBefore = stateRef.current.playerHP;
      const hpAfter = Math.min(maxHpAfter, hpBefore + CHALLENGE_REWARD_CONFIG.maxHpBonus);
      const nextState = {
        ...stateRef.current,
        playerHP: hpAfter,
      };
      playerMaxHpRef.current = maxHpAfter;
      setPlayerMaxHp(maxHpAfter);
      stateRef.current = nextState;
      setState(nextState);
      setChallengeStageClear(prev => prev ? { ...prev, playerHP: hpAfter } : prev);
      rewardLogs.push(`[成长] 玩家最大生命：${maxHpBefore} → ${maxHpAfter}`);
      rewardLogs.push(`[恢复] 玩家生命：${hpBefore} → ${hpAfter}`);
    } else if (rewardId === 'SHIELD_CHARGE') {
      const shieldBefore = playerShieldRef.current;
      const shieldAfter = CHALLENGE_REWARD_CONFIG.shieldLimit;
      playerShieldRef.current = shieldAfter;
      setPlayerShield(shieldAfter);
      rewardLogs.push(`[护盾] 玩家护盾：${shieldBefore} → ${shieldAfter}`);
    }

    setSelectedStageItemReward({ stage: completedStage, rewardId });
    claimedItemRewardStagesRef.current.add(completedStage);
    showShortNotice(`已获得：${reward.icon} ${reward.name}`, 900);
    setLogs(prev => [...prev, ...rewardLogs]);
  };

  const completeFinalChallengeVictoryForDev = (snapshot: GameState) => {
    invalidateBattleSession();
    battleFrozenRef.current = true;
    clearPendingBattleTimers();
    clearTransientBattleVisuals();
    enemyScorchMarksRef.current = 0;
    setEnemyScorchMarks(0);
    setScorchFeedback(null);
    setHasTriggeredCoreCombustionThisEnemy(false);
    setHasTriggeredVerdantSurgeThisEnemy(false);
    setHasTriggeredBlizzardThisEnemy(false);
    bossPressureRef.current = 0;
    setBossPressure(0);
    const finalState: GameState = {
      ...snapshot,
      aiHP: 0,
      phase: 'GAME_OVER',
      homePlayed: [],
      guestPlayed: [],
      winner: 'PLAYER',
    };
    stateRef.current = finalState;
    setState(finalState);
    setLogs(prev => [
      ...prev,
      `[挑战模式] 第 ${CHALLENGE_STAGE_CONFIG.totalStages} 关完成`,
      '[挑战模式] 挑战通关',
    ]);
    setIsProcessing(false);
    setSettlementSubPhase(null);
    setClashResult(null);
  };

  const devDefeatCurrentAi = () => {
    if (gameMode !== 'CHALLENGE' || state.winner) return;
    const snapshot: GameState = {
      ...stateRef.current,
      aiHP: 0,
    };
    stateRef.current = snapshot;
    setState(snapshot);
    setLogs(prev => [...prev, '[开发者] 当前 AI 已被击败']);

    if (currentChallengeStage < CHALLENGE_STAGE_CONFIG.totalStages) {
      enterChallengeStageClear(snapshot);
      return;
    }

    completeFinalChallengeVictoryForDev(snapshot);
  };

  const devFillPlayerHealth = () => {
    if (gameMode !== 'CHALLENGE') return;
    const nextState: GameState = {
      ...stateRef.current,
      playerHP: playerMaxHpRef.current,
    };
    stateRef.current = nextState;
    setState(nextState);
    setChallengeStageClear(prev => prev ? { ...prev, playerHP: playerMaxHpRef.current } : prev);
    setLogs(prev => [...prev, '[开发者] 玩家生命已补满']);
  };

  const devFillPlayerShield = () => {
    if (gameMode !== 'CHALLENGE') return;
    playerShieldRef.current = CHALLENGE_REWARD_CONFIG.shieldLimit;
    setPlayerShield(CHALLENGE_REWARD_CONFIG.shieldLimit);
    setLogs(prev => [...prev, '[开发者] 玩家护盾已充满']);
  };

  const devMaxSingleDeity = (deity: keyof FaithState, label: string) => {
    if (gameMode !== 'CHALLENGE') return;
    const faithForLv4 = FAITH_LEVEL_THRESHOLDS[4];
    setFaithState(prev => ({
      ...prev,
      [deity]: { faith: faithForLv4, level: getFaithLevel(faithForLv4) },
    }));
    setIsDevDeityPickerOpen(false);
    setLogs(prev => [...prev, `[开发者] ${label}已提升至 Lv.4`]);
  };

  const devMaxAllDeities = () => {
    if (gameMode !== 'CHALLENGE') return;
    const faithForLv4 = FAITH_LEVEL_THRESHOLDS[4];
    setFaithState({
      KITCHEN_GOD: { faith: faithForLv4, level: getFaithLevel(faithForLv4) },
      DEER_SPIRIT: { faith: faithForLv4, level: getFaithLevel(faithForLv4) },
      FROST_LORD: { faith: faithForLv4, level: getFaithLevel(faithForLv4) },
    });
    setIsDevDeityPickerOpen(false);
    setLogs(prev => [...prev, '[开发者] 三位神明已提升至 Lv.4']);
  };

  const devClaimCurrentReward = () => {
    if (gameMode !== 'CHALLENGE' || !challengeStageClear) return;
    const completedStage = challengeStageClear.completedStage;

    if (completedStage <= 2) {
      if (selectedStageReward?.stage === completedStage || claimedStageRewardStagesRef.current.has(completedStage)) return;
      claimStageFaithReward(DEITY_ORDER[0]);
      setLogs(prev => [...prev, '[开发者] 已自动领取当前奖励']);
      return;
    }

    if (isItemRewardStage(completedStage)) {
      if (selectedStageItemReward?.stage === completedStage || claimedItemRewardStagesRef.current.has(completedStage)) return;
      const reward = STAGE_ITEM_REWARDS.find(item => item.id !== 'HAND_SLOT' || !hasClaimedHandSlotReward);
      if (!reward) return;
      claimStageItemReward(reward.id);
      setLogs(prev => [...prev, '[开发者] 已自动领取当前奖励']);
    }
  };

  const finishMutationStage = useCallback((playerCardId?: string) => {
    setState(prev => {
      const logsToAppend: string[] = [];
      const selectedPlayerCard = playerCardId
        ? prev.playerHand.find(card => card.id === playerCardId)
        : undefined;
      const playerHand = playerCardId
        ? prev.playerHand.map(applyMutationToCard(playerCardId, activeMutationType, completedClashCountRef.current))
        : prev.playerHand;

      if (playerCardId) {
        logsToAppend.push(`[玩家] 获得“${
          selectedPlayerCard
            ? (activeMutationType === 'FOREST'
              ? `${forestCardLabel(selectedPlayerCard.type)}·幼苗`
              : mutationCardLabel(activeMutationType, selectedPlayerCard.type))
            : `${activeMutationLabel}异变牌`
        }”`);
      }

      let aiHand = prev.aiHand;
      if (countAllMutatedCards(aiHand) >= mutationLimit) {
        logsToAppend.push('[环境事件] 对手异变牌已达上限，本次感染跳过');
      } else {
        const aiCandidates = getActiveMutationCandidates(aiHand);
        const selectedAiCard = selectAiMutationCandidate(aiCandidates, aiHand);
        if (selectedAiCard) {
          aiHand = aiHand.map(applyMutationToCard(selectedAiCard.id, activeMutationType, completedClashCountRef.current));
          logsToAppend.push('[环境事件] 对手获得 1 张异变牌');
          logsToAppend.push(`[对手异变牌] 当前总数：${countAllMutatedCards(aiHand)} / ${mutationLimit}`);
          setMutationAnimation({ side: 'AI', token: Date.now() });
          setAiMutationCountPulse(true);
          showMutationPhaseNotice('对手完成感染', 700);
          scheduleSettlementTimer(() => {
            setMutationAnimation(null);
            setAiMutationCountPulse(false);
          }, 620);
        } else {
          logsToAppend.push('[环境事件] 当前没有可感染的普通牌');
        }
      }

      if (logsToAppend.length > 0) {
        setLogs(logPrev => [...logPrev, ...logsToAppend]);
      }

      return {
        ...prev,
        playerHand,
        aiHand,
      };
    });

    setMutationCandidates([]);
    if (playerCardId) {
      setMutatedCardGlowIds(prev => ({ ...prev, [playerCardId]: true }));
      setPlayerMutationCountPulse(true);
      showMutationPhaseNotice(`${activeMutationLabel}感染完成`, 650);
      scheduleSettlementTimer(() => {
        setMutatedCardGlowIds(prev => {
          const next = { ...prev };
          delete next[playerCardId];
          return next;
        });
        setPlayerMutationCountPulse(false);
      }, 900);
    }
    const continueTurn = continueAfterMutationRef.current;
    continueAfterMutationRef.current = null;
    if (continueTurn) {
      scheduleSettlementTimer(() => {
        switchToNextEnvironmentIfNeeded();
        continueTurn();
      }, 300);
    }
  }, [activeMutationLabel, activeMutationType, getActiveMutationCandidates, mutationLimit, scheduleSettlementTimer, showMutationPhaseNotice, switchToNextEnvironmentIfNeeded]);

  const handleMutationPick = useCallback((cardId: string) => {
    const selectedCandidate = mutationCandidates.find(card => card.id === cardId);
    if (!selectedCandidate) return;

    setMutationCandidates([]);
    pulseMutationEvent();
    setMutationAnimation({ side: 'PLAYER', cardId, token: Date.now() });
    scheduleSettlementTimer(() => {
      finishMutationStage(cardId);
      scheduleSettlementTimer(() => {
        setMutationAnimation(null);
      }, 160);
    }, 620);
  }, [finishMutationStage, mutationCandidates, pulseMutationEvent, scheduleSettlementTimer]);

  const handleGlacierEchoPick = useCallback((cardId: string) => {
    const selectedCandidate = glacierEchoCandidates.find(card => card.id === cardId);
    if (!selectedCandidate) return;

    setGlacierEchoCandidates([]);
    const continueTurn = continueAfterGlacierEchoRef.current;
    continueAfterGlacierEchoRef.current = null;
    if (continueTurn) {
      continueTurn(cardId);
    }
  }, [glacierEchoCandidates]);

  // --- SETTLEMENT LOGIC ---
  const handleSettlement = useCallback((hCards: Card[], gCards: Card[]) => {
    clearSettlementTimers();
    setIsProcessing(true);
    setSettlementSubPhase('resolving');

    const clashSnapshot = stateRef.current;
    const playerRoleAtClash = clashSnapshot.playerRole;
    const aiRoleAtClash = clashSnapshot.aiRole;

    let hDamage = 0;
    let gDamage = 0;
    let remainingHome = [...hCards];
    let remainingGuest = [...gCards];
    const guestDamagingCards: Card[] = [];
    const glacierReclaims: Array<{ side: 'HOME' | 'GUEST'; card: Card }> = [];

    const matches: Array<{
      text: string;
      winner: 'HOME' | 'GUEST' | 'TIE' | 'DIRECT';
      homeType?: CardType;
      guestType?: CardType;
      homeMutationType?: Card['mutationType'];
      guestMutationType?: Card['mutationType'];
      volcanoDamage?: number;
    }> = [];
    const resultLogs: string[] = [];
    const ownerForSide = (side: 'HOME' | 'GUEST') =>
      playerRoleAtClash === side ? 'PLAYER' as const : 'AI' as const;
    const addGlacierReclaim = (side: 'HOME' | 'GUEST', card: Card) => {
      if (card.mutationType !== 'GLACIER') return;
      glacierReclaims.push({ side, card });
    };

    // 1. Guest counters Home.
    const matchedHomeIndices = new Set<number>();
    const usedGuest = new Set<string>();
    for (const gCard of remainingGuest) {
      const matchIdx = remainingHome.findIndex((hCard, idx) =>
        !matchedHomeIndices.has(idx) && WIN_MAP[gCard.type] === hCard.type
      );
      if (matchIdx !== -1) {
        matchedHomeIndices.add(matchIdx);
        usedGuest.add(gCard.id);
        guestDamagingCards.push(gCard);
        hDamage += 1;
        matches.push({
          text: `${gCard.type} > ${remainingHome[matchIdx].type}`,
          winner: 'GUEST',
          homeType: remainingHome[matchIdx].type,
          guestType: gCard.type,
          homeMutationType: remainingHome[matchIdx].mutationType,
          guestMutationType: gCard.mutationType,
          volcanoDamage: gCard.mutationType === 'VOLCANO' ? 1 : 0,
        });
        resultLogs.push(zhCN.logs.result(battleCardLabel(gCard), '克制', battleCardLabel(remainingHome[matchIdx])));
      }
    }

    remainingHome = remainingHome.filter((_, idx) => !matchedHomeIndices.has(idx));
    remainingGuest = remainingGuest.filter(card => !usedGuest.has(card.id));

    // 2. Equal cards cancel each other.
    const guestAfterDraws = [...remainingGuest];
    const finalHomeAttack: Card[] = [];
    for (const hCard of remainingHome) {
      const drawIdx = guestAfterDraws.findIndex(card => card.type === hCard.type);
      if (drawIdx !== -1) {
        addGlacierReclaim('HOME', hCard);
        addGlacierReclaim('GUEST', guestAfterDraws[drawIdx]);
        matches.push({
          text: `${hCard.type} = ${guestAfterDraws[drawIdx].type}`,
          winner: 'TIE',
          homeType: hCard.type,
          guestType: guestAfterDraws[drawIdx].type,
          homeMutationType: hCard.mutationType,
          guestMutationType: guestAfterDraws[drawIdx].mutationType,
        });
        resultLogs.push(zhCN.logs.result(battleCardLabel(hCard), '抵消', battleCardLabel(guestAfterDraws[drawIdx])));
        guestAfterDraws.splice(drawIdx, 1);
      } else {
        finalHomeAttack.push(hCard);
      }
    }

    const guestVolcanoHits = guestDamagingCards.filter(card => card.mutationType === 'VOLCANO').length;
    const guestPlayedVolcanoCards = gCards.filter(card => card.mutationType === 'VOLCANO').length;
    const playerGlacierReclaims = glacierReclaims.filter(reclaim => ownerForSide(reclaim.side) === 'PLAYER');
    const aiGlacierReclaims = glacierReclaims.filter(reclaim => ownerForSide(reclaim.side) === 'AI');
    playerGlacierReclaims.forEach(({ card }) => {
      resultLogs.push(`[冰川回收] ${glacierCardLabel(card.type)}形成平局，返回手牌`);
      if (gameMode === 'CHALLENGE' && faithState.FROST_LORD.level >= 1) {
        const before = playerFrostSigilsRef.current;
        const after = Math.min(FROST_LORD_CONFIG.frostSigilLimit, before + 1);
        playerFrostSigilsRef.current = after;
        setPlayerFrostSigils(after);
        resultLogs.push(`[霜君] 冰川牌平局回收，获得霜签：${before} → ${after}`);
      }
      if (card.glacierEchoUsed) {
        resultLogs.push('[冰川回收] 该冰川牌已使用过“极寒回响”');
      }
    });
    if (aiGlacierReclaims.length > 0) {
      resultLogs.push(`[冰川回收] 对手有 ${aiGlacierReclaims.length} 张冰川牌形成平局并返回手牌`);
    }
    const guestVolcanoDamage = calculateVolcanoDamage({
      baseDamage: guestDamagingCards.length,
      successfulVolcanoHits: guestVolcanoHits,
      playedVolcanoCards: guestPlayedVolcanoCards,
    });
    const guestVolcanoBonus = guestVolcanoDamage.mutationBonus;
    const guestResonanceBonus = guestVolcanoDamage.resonanceBonus;
    hDamage += guestVolcanoDamage.mutationBonus + guestVolcanoDamage.resonanceBonus;

    const baseHomeDamage = finalHomeAttack.length;
    const homeVolcanoHits = finalHomeAttack.filter(card => card.mutationType === 'VOLCANO').length;
    const homePlayedVolcanoCards = hCards.filter(card => card.mutationType === 'VOLCANO').length;
    const homeVolcanoDamage = calculateVolcanoDamage({
      baseDamage: baseHomeDamage,
      successfulVolcanoHits: homeVolcanoHits,
      playedVolcanoCards: homePlayedVolcanoCards,
    });
    const homeVolcanoBonus = homeVolcanoDamage.mutationBonus;
    const homeResonanceBonus = homeVolcanoDamage.resonanceBonus;
    gDamage = baseHomeDamage;
    gDamage += homeVolcanoDamage.mutationBonus + homeVolcanoDamage.resonanceBonus;

    for (const hCard of finalHomeAttack) {
      matches.push({
        text: `${hCard.type} (DIRECT)`,
        winner: 'HOME',
        homeType: hCard.type,
        homeMutationType: hCard.mutationType,
        volcanoDamage: hCard.mutationType === 'VOLCANO' ? 1 : 0,
      });
    }

    const baseGuestDamage = guestDamagingCards.length;
    const baseDamageToHome = baseGuestDamage;
    const volcanoDamageToHome = guestVolcanoBonus;
    const resonanceDamageToHome = guestResonanceBonus;
    const baseDamageToGuest = baseHomeDamage;
    const volcanoDamageToGuest = homeVolcanoBonus;
    const resonanceDamageToGuest = homeResonanceBonus;
    const playerIncomingDamage = playerRoleAtClash === 'HOME' ? hDamage : gDamage;
    const bossPressureWillTrigger =
      isBossPressureActive
      && bossPressureThreshold > 0
      && bossPressureBonusDamage > 0
      && bossPressureRef.current >= bossPressureThreshold
      && playerIncomingDamage > 0;
    const bossPressureDamageBonus = bossPressureWillTrigger ? bossPressureBonusDamage : 0;
    const playerIncomingDamageWithBossPressure = playerIncomingDamage + bossPressureDamageBonus;
    const playerShieldAbsorb = absorbPlayerDamageWithShield(playerIncomingDamageWithBossPressure);
    const playerDamage = playerShieldAbsorb.hpDamage;
    const aiDamage = aiRoleAtClash === 'HOME' ? hDamage : gDamage;
    const playerBaseDamage = playerRoleAtClash === 'HOME' ? baseDamageToHome : baseDamageToGuest;
    const aiBaseDamage = aiRoleAtClash === 'HOME' ? baseDamageToHome : baseDamageToGuest;
    const playerVolcanoDamage = playerRoleAtClash === 'HOME' ? volcanoDamageToHome : volcanoDamageToGuest;
    const aiVolcanoDamage = aiRoleAtClash === 'HOME' ? volcanoDamageToHome : volcanoDamageToGuest;
    const playerResonanceDamage = playerRoleAtClash === 'HOME' ? resonanceDamageToHome : resonanceDamageToGuest;
    const aiResonanceDamage = aiRoleAtClash === 'HOME' ? resonanceDamageToHome : resonanceDamageToGuest;
    const playerSuccessfulVolcanoHits = playerRoleAtClash === 'HOME'
      ? finalHomeAttack.filter(card => card.mutationType === 'VOLCANO').length
      : guestDamagingCards.filter(card => card.mutationType === 'VOLCANO').length;
    const playerTriggeredVolcanoResonance = playerRoleAtClash === 'HOME'
      ? homeResonanceBonus > 0
      : guestResonanceBonus > 0;
    const homeInitialHP = playerRoleAtClash === 'HOME' ? clashSnapshot.playerHP : clashSnapshot.aiHP;
    const guestInitialHP = playerRoleAtClash === 'GUEST' ? clashSnapshot.playerHP : clashSnapshot.aiHP;
    const homeMaxHP = playerRoleAtClash === 'HOME' ? playerMaxHpRef.current : currentAiMaxHP;
    const guestMaxHP = playerRoleAtClash === 'GUEST' ? playerMaxHpRef.current : currentAiMaxHP;
    const homeHpAfterDamage = Math.max(0, homeInitialHP - (playerRoleAtClash === 'HOME' ? playerDamage : hDamage));
    const guestHpAfterDamage = Math.max(0, guestInitialHP - (playerRoleAtClash === 'GUEST' ? playerDamage : gDamage));
    const homeMatureForestHits = finalHomeAttack.filter(isMatureForestCard).length;
    const guestMatureForestHits = guestDamagingCards.filter(isMatureForestCard).length;
    const homePlayedMatureForestCards = hCards.filter(isMatureForestCard).length;
    const guestPlayedMatureForestCards = gCards.filter(isMatureForestCard).length;
    const homeCanTriggerSymbiosis = homePlayedMatureForestCards >= 2 && homeMatureForestHits >= 1;
    const guestCanTriggerSymbiosis = guestPlayedMatureForestCards >= 2 && guestMatureForestHits >= 1;
    const symbiosisOwner: 'HOME' | 'GUEST' | null = homeCanTriggerSymbiosis
      ? 'HOME'
      : guestCanTriggerSymbiosis
        ? 'GUEST'
        : null;
    const homeForestRecovery = calculateForestRecovery({
      successfulMatureForestHits: homeMatureForestHits,
      playedMatureForestCards: symbiosisOwner === 'HOME'
        ? homePlayedMatureForestCards
        : Math.min(homePlayedMatureForestCards, 1),
      currentHp: homeHpAfterDamage,
      maxHp: homeMaxHP,
    });
    const guestForestRecovery = calculateForestRecovery({
      successfulMatureForestHits: guestMatureForestHits,
      playedMatureForestCards: symbiosisOwner === 'GUEST'
        ? guestPlayedMatureForestCards
        : Math.min(guestPlayedMatureForestCards, 1),
      currentHp: guestHpAfterDamage,
      maxHp: guestMaxHP,
    });
    const playerForestRecovery = playerRoleAtClash === 'HOME'
      ? homeForestRecovery.finalRecovery
      : guestForestRecovery.finalRecovery;
    const aiForestRecovery = aiRoleAtClash === 'HOME'
      ? homeForestRecovery.finalRecovery
      : guestForestRecovery.finalRecovery;
    const playerForestRecoveryDetail = playerRoleAtClash === 'HOME'
      ? homeForestRecovery
      : guestForestRecovery;
    const playerTheoreticalForestRecovery = playerForestRecoveryDetail.baseRecovery + playerForestRecoveryDetail.symbiosisBonus;
    const playerForestOverflowRecovery = Math.max(0, playerTheoreticalForestRecovery - playerForestRecovery);
    const playerHpAfterDamage = Math.max(0, clashSnapshot.playerHP - playerDamage);
    const aiHpAfterDamage = Math.max(0, clashSnapshot.aiHP - aiDamage);
    const resolvedPlayerHP = Math.min(playerMaxHpRef.current, playerHpAfterDamage + playerForestRecovery);
    const resolvedAiHP = Math.min(currentAiMaxHP, aiHpAfterDamage + aiForestRecovery);
    const canGenerateDewdrops =
      gameMode === 'CHALLENGE'
      && faithState.DEER_SPIRIT.level >= 1
      && playerForestOverflowRecovery > 0;
    const dewdropsBeforeGain = playerDewdropsRef.current;
    const dewdropsAfterGain = canGenerateDewdrops
      ? Math.min(DEER_SPIRIT_CONFIG.dewdropLimit, dewdropsBeforeGain + playerForestOverflowRecovery)
      : dewdropsBeforeGain;
    const dewdropsGained = dewdropsAfterGain - dewdropsBeforeGain;
    const canAutoHealWithDewdrop =
      gameMode === 'CHALLENGE'
      && faithState.DEER_SPIRIT.level >= 1
      && playerDamage > 0
      && resolvedPlayerHP > 0
      && resolvedPlayerHP < playerMaxHpRef.current
      && dewdropsAfterGain > 0;
    const dewdropHeal = canAutoHealWithDewdrop
      ? Math.min(DEER_SPIRIT_CONFIG.autoHealPerClash, dewdropsAfterGain, playerMaxHpRef.current - resolvedPlayerHP)
      : 0;
    const dewdropsAfterAutoHeal = dewdropsAfterGain - dewdropHeal;
    const settledPlayerHP = Math.min(playerMaxHpRef.current, resolvedPlayerHP + dewdropHeal);
    const forestMutationCountdownReduction =
      homeForestRecovery.symbiosisTriggered || guestForestRecovery.symbiosisTriggered
        ? 1
        : 0;

    const appendDamageBreakdownLogs = (
      baseDamage: number,
      volcanoBonus: number,
      resonanceBonus: number,
      totalDamage: number,
      damagingCards: Card[],
      bossBonus = 0,
    ) => {
      if (totalDamage <= 0) return;
      resultLogs.push(`[伤害] 基础伤害：${baseDamage}`);
      const volcanoLog = buildVolcanoDamageLog(damagingCards, volcanoBonus);
      if (volcanoLog) resultLogs.push(volcanoLog);
      if (bossBonus > 0) resultLogs.push(`[Boss] 命运压迫额外伤害：+${bossBonus}`);
      if (resonanceBonus > 0) resultLogs.push(`[羁绊] 触发“灼烧共鸣”：+${VOLCANO_ENVIRONMENT_CONFIG.resonanceBonusDamage}`);
      resultLogs.push(`[结算] 最终伤害：${totalDamage}`);
      if (bossBonus > 0) {
        const parts = [
          `基础 ${baseDamage}`,
          ...(volcanoBonus > 0 ? [`火山异变 ${volcanoBonus}`] : []),
          ...(resonanceBonus > 0 ? [`灼烧共鸣 ${resonanceBonus}`] : []),
          `命运压迫 ${bossBonus}`,
        ];
        resultLogs.push(`[伤害] ${parts.join(' + ')} = ${totalDamage}`);
      } else if (resonanceBonus > 0) {
        resultLogs.push(`[伤害] 基础 ${baseDamage} + 火山异变 ${volcanoBonus} + 灼烧共鸣 ${resonanceBonus} = ${totalDamage}`);
      } else if (volcanoBonus > 0) {
        resultLogs.push(`[伤害] 基础 ${baseDamage} + 火山异变 ${volcanoBonus} = ${totalDamage}`);
      }
    };

    if (gCards.length === 0) resultLogs.push(zhCN.logs.noDefense);
    const homeUser = playerRoleAtClash === 'HOME' ? '玩家' : '对手';
    const guestUser = playerRoleAtClash === 'GUEST' ? '玩家' : '对手';
    const homeTarget = aiRoleAtClash === 'GUEST' ? '对手' : '玩家';
    const guestTarget = aiRoleAtClash === 'HOME' ? '对手' : '玩家';
    if (homeResonanceBonus > 0) {
      resultLogs.push(`[羁绊] ${homeUser}触发“灼烧共鸣”`);
      resultLogs.push(`[灼烧] ${homeTarget}额外受到 ${VOLCANO_ENVIRONMENT_CONFIG.resonanceBonusDamage} 点伤害`);
    }
    if (guestResonanceBonus > 0) {
      resultLogs.push(`[羁绊] ${guestUser}触发“灼烧共鸣”`);
      resultLogs.push(`[灼烧] ${guestTarget}额外受到 ${VOLCANO_ENVIRONMENT_CONFIG.resonanceBonusDamage} 点伤害`);
    }
    if (bossPressureWillTrigger) {
      resultLogs.push(`[Boss] 命运压迫触发，额外造成 ${bossPressureBonusDamage} 点伤害`);
    }
    if (aiDamage > 0) {
      appendDamageBreakdownLogs(aiBaseDamage, aiVolcanoDamage, aiResonanceDamage, aiDamage, aiRoleAtClash === 'HOME' ? guestDamagingCards : finalHomeAttack);
      resultLogs.push(zhCN.logs.aiDamage(aiDamage));
    }
    if (playerIncomingDamageWithBossPressure > 0) {
      appendDamageBreakdownLogs(playerBaseDamage, playerVolcanoDamage, playerResonanceDamage, playerIncomingDamageWithBossPressure, playerRoleAtClash === 'HOME' ? guestDamagingCards : finalHomeAttack, bossPressureDamageBonus);
      resultLogs.push(...playerShieldAbsorb.logs);
      if (playerDamage > 0) {
        resultLogs.push(zhCN.logs.playerDamage(playerDamage));
      }
    }
    if (playerForestRecovery > 0) {
      resultLogs.push('[森林恢复] 成熟森林牌成功命中');
      resultLogs.push(`[恢复] 玩家 HP：${playerHpAfterDamage} → ${resolvedPlayerHP}`);
      resultLogs.push(`[恢复] 森林环境恢复：+${playerForestRecovery}`);
    }
    if (aiForestRecovery > 0) {
      resultLogs.push('[森林恢复] 对手通过森林异变牌恢复 HP');
      resultLogs.push(`[恢复] 对手 HP：${aiHpAfterDamage} → ${resolvedAiHP}`);
      resultLogs.push(`[恢复] 森林环境恢复：+${aiForestRecovery}`);
    }
    const playerSymbiosisTriggered = playerRoleAtClash === 'HOME'
      ? homeForestRecovery.symbiosisTriggered
      : guestForestRecovery.symbiosisTriggered;
    const aiSymbiosisTriggered = aiRoleAtClash === 'HOME'
      ? homeForestRecovery.symbiosisTriggered
      : guestForestRecovery.symbiosisTriggered;
    const sproutSeedlingCandidate = clashSnapshot.playerHand.find(card =>
      card.mutationType === 'FOREST' && card.forestGrowthStage === 'SEEDLING'
    );
    const canTriggerSprout =
      gameMode === 'CHALLENGE'
      && faithState.DEER_SPIRIT.level >= 2
      && playerSymbiosisTriggered;
    if (playerSymbiosisTriggered) {
      resultLogs.push('[羁绊] 触发“共生绽放”');
    }
    if (aiSymbiosisTriggered) {
      resultLogs.push('[羁绊] 对手触发“共生绽放”');
    }
    if (forestMutationCountdownReduction > 0) {
      resultLogs.push('[环境事件] 下一次森林感染倒计时减少 1 轮');
      pulseMutationEvent();
    }
    if (canGenerateDewdrops) {
      resultLogs.push('[鹿灵] 触发“露华”');
      if (dewdropsGained > 0) {
        resultLogs.push(`[鹿灵] 溢出恢复转化为露珠：${dewdropsBeforeGain} → ${dewdropsAfterGain}`);
      }
      if (dewdropsGained < playerForestOverflowRecovery) {
        resultLogs.push(`[鹿灵] 露珠已达上限：${DEER_SPIRIT_CONFIG.dewdropLimit} / ${DEER_SPIRIT_CONFIG.dewdropLimit}`);
      }
    }
    if (dewdropHeal > 0) {
      resultLogs.push(`[鹿灵] 自动消耗露珠：${dewdropsAfterGain} → ${dewdropsAfterAutoHeal}`);
      resultLogs.push(`[恢复] 露珠恢复 ${dewdropHeal} 点生命：${resolvedPlayerHP} → ${settledPlayerHP}`);
    }
    if (canTriggerSprout) {
      resultLogs.push('[鹿灵] 触发“催芽”');
      resultLogs.push(
        sproutSeedlingCandidate
          ? '[森林成长] 1 张森林幼苗已立即成熟'
          : '[森林成长] 当前没有可成熟的森林幼苗'
      );
    }
    if (
      gameMode === 'CHALLENGE'
      && faithState.KITCHEN_GOD.level >= 1
      && (
        playerSuccessfulVolcanoHits > 0
        || (faithState.KITCHEN_GOD.level >= 2 && playerTriggeredVolcanoResonance)
      )
    ) {
      const scorchBefore = enemyScorchMarksRef.current;
      let scorchAfter = Math.min(
        KITCHEN_GOD_CONFIG.scorchMarkLimit,
        scorchBefore + playerSuccessfulVolcanoHits
      );
      const baseScorchAfter = scorchAfter;
      const triggeredFuel = faithState.KITCHEN_GOD.level >= 2 && playerTriggeredVolcanoResonance;
      if (playerSuccessfulVolcanoHits > 0 && baseScorchAfter > scorchBefore) {
        resultLogs.push(`[灶神] 火山异变牌命中，敌方灼痕：${scorchBefore} → ${baseScorchAfter}`);
      }
      if (triggeredFuel) {
        const fuelBefore = scorchAfter;
        const fuelAfter = Math.min(KITCHEN_GOD_CONFIG.scorchMarkLimit, fuelBefore + 1);
        scorchAfter = fuelAfter;
        resultLogs.push('[灶神] 触发“添薪”');
        resultLogs.push('[灶神] 灼烧共鸣额外增加 1 层灼痕');
        resultLogs.push(`[灶神] 敌方灼痕：${fuelBefore} → ${fuelAfter}`);
      }
      if (scorchAfter !== scorchBefore) {
        enemyScorchMarksRef.current = scorchAfter;
        setEnemyScorchMarks(scorchAfter);
      }
      setScorchFeedback({ type: triggeredFuel ? 'fuel' : 'mark', token: Date.now() });
      scheduleSettlementTimer(() => {
        setScorchFeedback(null);
      }, 760);
    }
    if (homeResonanceBonus > 0 || guestResonanceBonus > 0) {
      const burnTargets = [
        ...(homeResonanceBonus > 0 ? [homeTarget === '玩家' ? 'PLAYER' as const : 'AI' as const] : []),
        ...(guestResonanceBonus > 0 ? [guestTarget === '玩家' ? 'PLAYER' as const : 'AI' as const] : []),
      ];
      const source = homeResonanceBonus > 0 ? homeUser : guestUser;
      const target = homeResonanceBonus > 0 ? homeTarget : guestTarget;
      setBurnFeedback({ targets: burnTargets, token: Date.now() });
      setResonanceAnimation({
        source: source === '玩家' ? 'PLAYER' : 'AI',
        target: target === '玩家' ? 'PLAYER' : 'AI',
        token: Date.now(),
      });
      scheduleSettlementTimer(() => {
        setResonanceAnimation(null);
        setBurnFeedback(null);
      }, 780);
    }
    setLogs(prev => [...prev, ...resultLogs]);
    if (bossPressureWillTrigger) {
      bossPressureRef.current = 0;
      setBossPressure(0);
    }
    if (dewdropsAfterAutoHeal !== playerDewdropsRef.current) {
      playerDewdropsRef.current = dewdropsAfterAutoHeal;
      setPlayerDewdrops(dewdropsAfterAutoHeal);
    }
    if (canTriggerSprout) {
      if (sproutSeedlingCandidate) {
        setState(prev => {
          const nextState = {
            ...prev,
            playerHand: prev.playerHand.map(card =>
              card.id === sproutSeedlingCandidate.id
                ? { ...card, forestGrowthStage: 'MATURE' as const }
                : card
            ),
          };
          stateRef.current = nextState;
          return nextState;
        });
        setMaturedCardGlowIds(prev => ({ ...prev, [sproutSeedlingCandidate.id]: true }));
        scheduleSettlementTimer(() => {
          setMaturedCardGlowIds(prev => {
            const copy = { ...prev };
            delete copy[sproutSeedlingCandidate.id];
            return copy;
          });
        }, 800);
      }
      setSproutFeedback({ success: Boolean(sproutSeedlingCandidate), token: Date.now() });
      scheduleSettlementTimer(() => setSproutFeedback(null), 780);
    }

    setClashResult({
      playerHPChange: playerDamage,
      aiHPChange: aiDamage,
      matches,
      playerRole: playerRoleAtClash,
      aiRole: aiRoleAtClash,
      hDamage,
      gDamage,
      baseHomeDamage,
      baseGuestDamage,
      homeVolcanoBonus,
      guestVolcanoBonus,
      playerBaseDamage,
      aiBaseDamage,
      playerVolcanoDamage,
      aiVolcanoDamage,
      playerResonanceDamage,
      aiResonanceDamage,
      homeResonanceBonus,
      guestResonanceBonus,
      playerForestRecovery,
      aiForestRecovery,
      playerHpAfterDamage,
      aiHpAfterDamage,
      playerSymbiosisTriggered,
      aiSymbiosisTriggered,
      forestMutationCountdownReduction,
      noDefense: gCards.length === 0,
    });

    scheduleSettlementTimer(() => {
      if (playerDamage > 0) {
        setPlayerHPShake(true);
        setPlayerHPFlash(true);
        scheduleSettlementTimer(() => {
          setPlayerHPShake(false);
          setPlayerHPFlash(false);
        }, 500);
      }
      if (aiDamage > 0) {
        setAiHPShake(true);
        setAiHPFlash(true);
        scheduleSettlementTimer(() => {
          setAiHPShake(false);
          setAiHPFlash(false);
        }, 500);
      }
      const recoveryTargets = [
        ...(playerForestRecovery > 0 || playerSymbiosisTriggered ? ['PLAYER' as const] : []),
        ...(aiForestRecovery > 0 || aiSymbiosisTriggered ? ['AI' as const] : []),
      ];
      if (recoveryTargets.length > 0) {
        setForestRecoveryFeedback({
          targets: recoveryTargets,
          recoveryByTarget: {
            PLAYER: playerForestRecovery,
            AI: aiForestRecovery,
          },
          symbiosisByTarget: {
            PLAYER: playerSymbiosisTriggered,
            AI: aiSymbiosisTriggered,
          },
          token: Date.now(),
        });
        const recoveryFeedbackDuration = playerSymbiosisTriggered || aiSymbiosisTriggered ? 1000 : 720;
        scheduleSettlementTimer(() => {
          setForestRecoveryFeedback(null);
        }, recoveryFeedbackDuration);
      }
      if (dewdropsGained > 0) {
        setDewdropFeedback({ type: 'gain', amount: dewdropsGained, token: Date.now() });
        scheduleSettlementTimer(() => {
          if (dewdropHeal > 0) return;
          setDewdropFeedback(null);
        }, 780);
      }
      if (dewdropHeal > 0) {
        scheduleSettlementTimer(() => {
          setDewdropFeedback({ type: 'heal', amount: dewdropHeal, token: Date.now() });
          setPlayerHPFlash(true);
          scheduleSettlementTimer(() => {
            setPlayerHPFlash(false);
            setDewdropFeedback(null);
          }, 760);
        }, dewdropsGained > 0 ? 640 : 220);
      }
      if (playerShieldAbsorb.absorbed > 0) {
        playerShieldRef.current = playerShieldAbsorb.shieldAfter;
        setPlayerShield(playerShieldAbsorb.shieldAfter);
      }
      setState(prev => ({
        ...prev,
        playerHP: settledPlayerHP,
        aiHP: resolvedAiHP,
      }));
    }, 150);

    const finishTurn = () => {
      setSettlementSubPhase('round-end');
      scheduleSettlementTimer(() => {
        setState(prev => {
          let working = prev;
          let winner: 'PLAYER' | 'AI' | 'DRAW' | null = null;
          let extraActionLogs = '';

          if (working.playerHP <= 0 && working.aiHP <= 0) winner = 'DRAW';
          else if (working.aiHP <= 0) winner = 'PLAYER';
          else if (working.playerHP <= 0) winner = 'AI';

          if (!winner && working.drawPile.length === 0) {
            const recycle = recycleSharedDeckIfPossible(working);
            if (recycle.recycled) {
              working = recycle.state;
              extraActionLogs += `\n${recycle.logs.join('\n')}`;
            }
          }

          if (!winner && working.drawPile.length === 0) {
            const playerHandCount = working.playerHand.length;
            const aiHandCount = working.aiHand.length;
            if (playerHandCount === 0 && aiHandCount > 0) {
              winner = 'AI';
              setResourceDepletedWinnerDetail({ eng: '', chn: '失败：我方无可用卡牌' });
              extraActionLogs += '\n[系统] 失败：我方无可用卡牌';
            } else if (aiHandCount === 0 && playerHandCount > 0) {
              winner = 'PLAYER';
              setResourceDepletedWinnerDetail({ eng: '', chn: '胜利：敌方无可用卡牌' });
              extraActionLogs += '\n[系统] 胜利：敌方无可用卡牌';
            } else if (playerHandCount === 0 && aiHandCount === 0) {
              winner = 'DRAW';
              setResourceDepletedWinnerDetail({ eng: '', chn: '平局：双方资源耗尽' });
              extraActionLogs += '\n[系统] 平局：双方资源耗尽';
            } else {
              extraActionLogs += `\n${zhCN.logs.finalClashNoReplenish}\n${zhCN.logs.playerHandRemaining(playerHandCount)}\n${zhCN.logs.aiHandRemaining(aiHandCount)}`;
            }
          }

          const nextPlayerRole = working.playerRole === 'HOME' ? 'GUEST' : 'HOME';
          if (winner === 'PLAYER' && gameMode === 'CHALLENGE' && currentChallengeStage < CHALLENGE_STAGE_CONFIG.totalStages) {
            invalidateBattleSession();
            battleFrozenRef.current = true;
            clearPendingBattleTimers();
            clearTransientBattleVisuals();
            const stageClearState: GameState = {
              ...working,
              phase: 'CHALLENGE_STAGE_CLEAR',
              homePlayed: [],
              guestPlayed: [],
              winner: null,
              lastAction: working.lastAction + extraActionLogs,
            };
            stateRef.current = stageClearState;
            setChallengeStageClear({
              completedStage: currentChallengeStage,
              nextStage: currentChallengeStage + 1,
              playerHP: working.playerHP,
              retainedHandCount: working.playerHand.length,
              mutatedCardCount: countAllMutatedCards(working.playerHand),
            });
            setLogs(prevLogs => [
              ...prevLogs,
              `[挑战模式] 第 ${currentChallengeStage} 关完成`,
              '[系统] 当前战斗流程已冻结',
            ]);
            return stageClearState;
          }

          const nextState = {
            ...working,
            playerRole: nextPlayerRole,
            aiRole: nextPlayerRole === 'HOME' ? 'GUEST' : 'HOME',
            phase: winner ? 'GAME_OVER' : (nextPlayerRole === 'HOME' ? 'PLAYER_ATTACK' : 'AI_ATTACK'),
            homePlayed: [],
            guestPlayed: [],
            winner,
            lastAction: working.lastAction + extraActionLogs,
          };
          stateRef.current = nextState;
          return nextState;
        });
        setIsProcessing(false);
        setHasOfferedThisClash(false);
        setHasUsedDeitySkillThisClash(false);
        setSettlementSubPhase(null);
        setClashResult(null);
      }, 450);
    };

    const finishReplenishment = () => {
      setSettlementSubPhase('replenish-complete');
      setLogs(prev => [...prev, zhCN.logs.replenishComplete]);
      scheduleSettlementTimer(() => {
        const nextCompletedClashCount = completedClashCount + 1;
        setCompletedClashCount(nextCompletedClashCount);
        completedClashCountRef.current = nextCompletedClashCount;
        if (isBossPressureActive && bossPressureThreshold > 0) {
          const pressureBefore = bossPressureRef.current;
          const pressureAfter = Math.min(bossPressureThreshold, pressureBefore + 1);
          if (pressureAfter > pressureBefore) {
            bossPressureRef.current = pressureAfter;
            setBossPressure(pressureAfter);
            setLogs(prev => [
              ...prev,
              `[Boss] 命运压迫 +1：${pressureBefore} → ${pressureAfter}`,
              ...(pressureAfter >= bossPressureThreshold
                ? ['[Boss] 命运压迫已满，下一次 Boss 有效伤害 +1']
                : []),
            ]);
          }
        }
        const growthSnapshot = stateRef.current;
        const playerGrowth = advanceForestGrowth({
          hand: growthSnapshot.playerHand,
          completedClashCount: nextCompletedClashCount,
        });
        const aiGrowth = advanceForestGrowth({
          hand: growthSnapshot.aiHand,
          completedClashCount: nextCompletedClashCount,
        });
        const growthLogs = playerGrowth.maturedCards
          .map(card => `[森林成长] “${forestCardLabel(card.type)}”已成熟`);
        const maturedIds = [...playerGrowth.maturedCards, ...aiGrowth.maturedCards].map(card => card.id);
        if (growthLogs.length > 0) {
          setLogs(logPrev => [...logPrev, ...growthLogs]);
        }
        if (maturedIds.length > 0) {
          setMaturedCardGlowIds(prev => maturedIds.reduce(
            (next, id) => ({ ...next, [id]: true }),
            prev
          ));
          scheduleSettlementTimer(() => {
            setMaturedCardGlowIds(prev => {
              const next = { ...prev };
              maturedIds.forEach(id => {
                delete next[id];
              });
              return next;
            });
          }, 900);
        }

        const latest = {
          ...growthSnapshot,
          playerHand: playerGrowth.hand,
          aiHand: aiGrowth.hand,
        };
        stateRef.current = latest;
        setState(latest);

        const nextEnvironmentRoundsRemaining = Math.max(0, environmentRoundsRemainingRef.current - 1);
        environmentRoundsRemainingRef.current = nextEnvironmentRoundsRemaining;
        setEnvironmentRoundsRemaining(nextEnvironmentRoundsRemaining);
        setLogs(prev => [
          ...prev,
          currentModeConfig.environmentMode === 'ROTATION'
            ? `[环境路线] ${activeMutationLabel}阶段剩余：${nextEnvironmentRoundsRemaining} 轮`
            : `[环境事件] ${activeMutationLabel}环境持续中`,
        ]);

        const nextMutationCount = Math.min(
          mutationIntervalRounds,
          completedClashesSinceMutationRef.current + 1 + forestMutationCountdownReduction
        );

        if (latest.drawPile.length <= 0) {
          setLogs(prev => [...prev, '[环境事件] 公共牌库已耗尽，感染阶段关闭']);
          scheduleSettlementTimer(finishTurn, 350);
          return;
        }

        if (!canTriggerMutation(latest.drawPile.length, nextMutationCount, mutationIntervalRounds)) {
          completedClashesSinceMutationRef.current = nextMutationCount;
          setCompletedClashesSinceMutation(nextMutationCount);
          const roundsRemaining = mutationIntervalRounds - nextMutationCount;
          if (roundsRemaining === 1) {
            setLogs(prev => [...prev, `[环境事件] ${activeMutationLabel}感染将在 1 轮后触发`]);
          }
          scheduleSettlementTimer(() => {
            switchToNextEnvironmentIfNeeded();
            finishTurn();
          }, 350);
          return;
        }

        completedClashesSinceMutationRef.current = 0;
        setCompletedClashesSinceMutation(0);
        setLogs(prev => [...prev, `[环境事件] ${activeMutationLabel}感染已触发`]);
        continueAfterMutationRef.current = finishTurn;
        showMutationPhaseNotice(`${activeMutationLabel}感染阶段`, 700);
        pulseMutationEvent();

        if (countAllMutatedCards(latest.playerHand) >= mutationLimit) {
          setLogs(prev => [...prev, '[环境事件] 我方异变牌已达上限，本次感染跳过']);
          finishMutationStage();
          return;
        }

        const playerCandidates = getActiveMutationCandidates(latest.playerHand);
        if (playerCandidates.length === 0) {
          setLogs(prev => [...prev, '[环境事件] 当前没有可感染的普通牌']);
          finishMutationStage();
          return;
        }

        setMutationCandidates(playerCandidates);
      }, 650);
    };

    type DrawQueueSnapshotItem = DrawQueueItem & {
      beforeCount: number;
      afterCount: number;
    };

    const executeDrawQueue = (queue: DrawQueueSnapshotItem[], index = 0) => {
      if (index >= queue.length) {
        scheduleSettlementTimer(finishReplenishment, 350);
        return;
      }

      const action = queue[index];
      let current = stateRef.current;
      if (current.drawPile.length <= 0) {
        const recycle = tryRecycleSharedDeckState(current);
        current = recycle.state;
        if (!recycle.recycled || current.drawPile.length <= 0) {
          scheduleSettlementTimer(finishReplenishment, 350);
          return;
        }
      }

      const drawCount = Math.min(action.count, current.drawPile.length);
      if (drawCount <= 0) {
        scheduleSettlementTimer(finishReplenishment, 350);
        return;
      }

      const beforeDeckCount = current.drawPile.length;
      const drawnCards = current.drawPile.slice(0, drawCount);
      const nextDrawPile = current.drawPile.slice(drawCount);
      const afterDeckCount = nextDrawPile.length;

      if (action.user === 'PLAYER') {
        drawnCards.forEach((card, cardIndex) => {
          scheduleSettlementTimer(() => {
            addAnimation('DRAW_PLAYER', 110, 620, 420 + (current.playerHand.length + cardIndex) * 60, 648, card.type);
          }, cardIndex * 100);
        });
        triggerDeckFeedback(`我方补牌 +${drawCount}`, zhCN.logs.playerDraw(drawCount), `-${drawCount}`, `${beforeDeckCount} → ${afterDeckCount}`);
        setLogs(logPrev => [
          ...logPrev,
          zhCN.logs.playerDraw(drawCount),
          zhCN.logs.sharedDeckChange(beforeDeckCount, afterDeckCount),
        ]);
        const nextState = {
          ...current,
          playerHand: [...current.playerHand, ...drawnCards],
          drawPile: nextDrawPile,
        };
        stateRef.current = nextState;
        setState(nextState);
      } else {
        drawnCards.forEach((_, cardIndex) => {
          scheduleSettlementTimer(() => {
            addAnimation('DRAW_AI', 110, 620, 880 + (current.aiHand.length + cardIndex) * 40, 60, undefined);
          }, cardIndex * 100);
        });
        triggerDeckFeedback(`对手补牌 +${drawCount}`, zhCN.logs.aiDraw(drawCount), `-${drawCount}`, `${beforeDeckCount} → ${afterDeckCount}`);
        setLogs(logPrev => [
          ...logPrev,
          zhCN.logs.aiDraw(drawCount),
          zhCN.logs.sharedDeckChange(beforeDeckCount, afterDeckCount),
        ]);
        const nextState = {
          ...current,
          aiHand: [...current.aiHand, ...drawnCards],
          drawPile: nextDrawPile,
        };
        stateRef.current = nextState;
        setState(nextState);
      }

      scheduleSettlementTimer(() => executeDrawQueue(queue, index + 1), 650);
    };

    const beginReplenishment = () => {
      setSettlementSubPhase('replenishing');
      let latest = stateRef.current;
      if (latest.drawPile.length <= 0) {
        const recycle = tryRecycleSharedDeckState(latest);
        latest = recycle.state;
        if (recycle.recycled) {
          stateRef.current = latest;
          setState(latest);
        } else {
          setLogs(prev => [
            ...prev,
            zhCN.logs.finalClashNoReplenish,
            zhCN.logs.playerHandRemaining(latest.playerHand.length),
            zhCN.logs.aiHandRemaining(latest.aiHand.length),
          ]);
          scheduleSettlementTimer(finishTurn, 350);
          return;
        }
      }

      const currentPlayerHandLimit = gameMode === 'CHALLENGE' ? playerHandLimitRef.current : PLAYER_BASE_HAND_LIMIT;
      const playerNeed = Math.min(2, Math.max(0, currentPlayerHandLimit - latest.playerHand.length));
      const aiNeed = Math.min(2, Math.max(0, AI_BASE_HAND_LIMIT - latest.aiHand.length));
      const deckCount = latest.drawPile.length;
      const totalNeed = playerNeed + aiNeed;

      if (totalNeed <= 0) {
        scheduleSettlementTimer(finishReplenishment, 350);
        return;
      }

      let queue: DrawQueueItem[] = [];
      if (deckCount >= totalNeed) {
        if (playerNeed > 0) queue.push({ user: 'PLAYER', count: playerNeed });
        if (aiNeed > 0) queue.push({ user: 'AI', count: aiNeed });
      } else {
        const nextPlayerRole = latest.playerRole === 'HOME' ? 'GUEST' : 'HOME';
        let turn: DrawQueueItem['user'] = nextPlayerRole === 'HOME' ? 'PLAYER' : 'AI';
        let playerRemaining = playerNeed;
        let aiRemaining = aiNeed;
        while (playerRemaining > 0 || aiRemaining > 0) {
          if (turn === 'PLAYER') {
            if (playerRemaining > 0) {
              queue.push({ user: 'PLAYER', count: 1 });
              playerRemaining -= 1;
            }
            turn = 'AI';
          } else {
            if (aiRemaining > 0) {
              queue.push({ user: 'AI', count: 1 });
              aiRemaining -= 1;
            }
            turn = 'PLAYER';
          }
        }
        setLogs(prev => [...prev, zhCN.logs.limitedSharedDeck]);
      }

      const queueWithSnapshots = queue.map(action => ({
        ...action,
        beforeCount: 0,
        afterCount: 0,
      }));
      executeDrawQueue(queueWithSnapshots);
    };

    const startDiscardSequence = () => {
      const isChallengeStageWin =
        gameMode === 'CHALLENGE'
        && resolvedAiHP <= 0
        && settledPlayerHP > 0
        && currentChallengeStage < CHALLENGE_STAGE_CONFIG.totalStages;

      if ((settledPlayerHP <= 0 || resolvedAiHP <= 0) && !isChallengeStageWin) {
        if (gameMode === 'CHALLENGE' && resolvedAiHP <= 0 && settledPlayerHP > 0) {
          setLogs(prev => [
            ...prev,
            `[挑战模式] 第 ${CHALLENGE_STAGE_CONFIG.totalStages} 关完成`,
            '[挑战模式] 挑战通关',
          ]);
        }
        invalidateBattleSession();
        battleFrozenRef.current = true;
        clearPendingBattleTimers();
        enemyScorchMarksRef.current = 0;
        setEnemyScorchMarks(0);
        setScorchFeedback(null);
        setHasTriggeredCoreCombustionThisEnemy(false);
        setHasTriggeredVerdantSurgeThisEnemy(false);
        bossPressureRef.current = 0;
        setBossPressure(0);
        setState(prev => ({
          ...prev,
          playerHP: settledPlayerHP,
          aiHP: resolvedAiHP,
          phase: 'GAME_OVER',
          homePlayed: [],
          guestPlayed: [],
          winner: settledPlayerHP <= 0 && resolvedAiHP <= 0 ? 'DRAW' : resolvedAiHP <= 0 ? 'PLAYER' : 'AI',
        }));
        setIsProcessing(false);
        setSettlementSubPhase(null);
        setClashResult(null);
        return;
      }

      setSettlementSubPhase('move-to-discard');
      const playerPlayedCards = playerRoleAtClash === 'HOME' ? hCards : gCards;
      const aiPlayedCards = aiRoleAtClash === 'HOME' ? hCards : gCards;
      const playerReclaimedIds = new Set(
        glacierReclaims
          .filter(reclaim => ownerForSide(reclaim.side) === 'PLAYER')
          .map(reclaim => reclaim.card.id)
      );
      const aiReclaimedIds = new Set(
        glacierReclaims
          .filter(reclaim => ownerForSide(reclaim.side) === 'AI')
          .map(reclaim => reclaim.card.id)
      );
      const playerDiscardCards = playerPlayedCards.filter(card => !playerReclaimedIds.has(card.id));
      const aiDiscardCards = aiPlayedCards.filter(card => !aiReclaimedIds.has(card.id));
      const playerGlacierPlayedCount = playerPlayedCards.filter(card => card.mutationType === 'GLACIER').length;
      const aiGlacierPlayedCount = aiPlayedCards.filter(card => card.mutationType === 'GLACIER').length;
      const playerEchoCandidates = glacierReclaims
        .filter(reclaim => ownerForSide(reclaim.side) === 'PLAYER')
        .map(reclaim => reclaim.card)
        .filter(card => !card.glacierEchoUsed);
      const aiEchoCandidates = glacierReclaims
        .filter(reclaim => ownerForSide(reclaim.side) === 'AI')
        .map(reclaim => reclaim.card)
        .filter(card => !card.glacierEchoUsed);
      const playerEchoTriggered = playerGlacierPlayedCount >= 2 && playerEchoCandidates.length > 0;
      const aiEchoTriggered = !playerEchoTriggered && aiGlacierPlayedCount >= 2 && aiEchoCandidates.length > 0;
      const longestDiscardQueue = Math.max(playerDiscardCards.length, aiDiscardCards.length);
      const discardAnimationDuration = longestDiscardQueue > 0
        ? (longestDiscardQueue - 1) * 120 + 650
        : 250;

      const applyGlacierReturnAndDiscard = (selectedEchoCardId?: string) => {
        playerDiscardCards.forEach((card, index) => {
          scheduleSettlementTimer(() => addAnimation('DISCARD', 512, 430, 902, 620, card.type), index * 120);
        });
        aiDiscardCards.forEach((card, index) => {
          scheduleSettlementTimer(() => addAnimation('DISCARD', 512, 280, 750, 60, card.type), index * 120);
        });
        if (playerDiscardCards.length > 0) {
          setPlayerDiscardPrompt(`${zhCN.resources.playerDiscard} +${playerDiscardCards.length}`);
          scheduleSettlementTimer(() => setPlayerDiscardPrompt(null), 1500);
        }
        if (aiDiscardCards.length > 0) {
          setAiDiscardPrompt(`${zhCN.resources.aiDiscard} +${aiDiscardCards.length}`);
          scheduleSettlementTimer(() => setAiDiscardPrompt(null), 1500);
        }
        const aiSelectedEchoCard = aiEchoTriggered
          ? selectAiMutationCandidate(aiEchoCandidates, stateRef.current.aiHand)
          : null;
        const selectedAiEchoCardId = aiSelectedEchoCard?.id;
        const playerReturnCards = glacierReclaims
          .filter(reclaim => ownerForSide(reclaim.side) === 'PLAYER')
          .map(reclaim => (
            reclaim.card.id === selectedEchoCardId
              ? { ...reclaim.card, mutationType: 'GLACIER' as const, glacierEchoUsed: true }
              : removeMutationFromCard(reclaim.card)
          ));
        const aiReturnCards = glacierReclaims
          .filter(reclaim => ownerForSide(reclaim.side) === 'AI')
          .map(reclaim => (
            reclaim.card.id === selectedAiEchoCardId
              ? { ...reclaim.card, mutationType: 'GLACIER' as const, glacierEchoUsed: true }
              : removeMutationFromCard(reclaim.card)
          ));
        const echoLogs: string[] = [];

        if (selectedEchoCardId) {
          const selectedCard = playerEchoCandidates.find(card => card.id === selectedEchoCardId);
          echoLogs.push(`[冰川回收] “${selectedCard ? glacierCardLabel(selectedCard.type) : '冰川牌'}”保留异变属性`);
          echoLogs.push(`[冰川回收] “${selectedCard ? glacierCardLabel(selectedCard.type) : '冰川牌'}”已使用极寒回响次数：1 / 1`);
          if (gameMode === 'CHALLENGE' && faithState.FROST_LORD.level >= 2) {
            const before = playerFrostSigilsRef.current;
            const after = Math.min(FROST_LORD_CONFIG.frostSigilLimit, before + 1);
            playerFrostSigilsRef.current = after;
            setPlayerFrostSigils(after);
            echoLogs.push('[霜君] 触发“连雪”');
            echoLogs.push(`[霜君] 极寒回响额外获得霜签：${before} → ${after}`);
          }
        }

        playerReturnCards
          .filter(card => !card.mutationType)
          .forEach(() => {
            echoLogs.push('[冰川回收] 返回手牌并恢复为普通牌');
          });

        if (aiEchoTriggered) {
          echoLogs.push('[羁绊] 对手触发“极寒回响”');
          if (selectedAiEchoCardId) {
            echoLogs.push('[冰川回收] 对手有 1 张冰川牌保留异变属性');
          }
        }

        if (echoLogs.length > 0) {
          setLogs(prev => [...prev, ...echoLogs]);
        }

        const recycleTargets = [
          ...(playerReturnCards.length > 0 ? ['PLAYER' as const] : []),
          ...(aiReturnCards.length > 0 ? ['AI' as const] : []),
        ];
        if (recycleTargets.length > 0) {
          setGlacierRecycleFeedback({
            targets: recycleTargets,
            echoByTarget: {
              PLAYER: Boolean(selectedEchoCardId),
              AI: Boolean(selectedAiEchoCardId),
            },
            token: Date.now(),
          });
          scheduleSettlementTimer(() => setGlacierRecycleFeedback(null), 850);
        }

        setState(prev => {
          const nextState = {
            ...prev,
            playerHand: [...prev.playerHand, ...playerReturnCards],
            aiHand: [...prev.aiHand, ...aiReturnCards],
            playerDiscardPile: [...prev.playerDiscardPile, ...playerDiscardCards],
            aiDiscardPile: [...prev.aiDiscardPile, ...aiDiscardCards],
          };
          stateRef.current = nextState;
          return nextState;
        });
        if (isChallengeStageWin) {
          scheduleSettlementTimer(() => {
            enterChallengeStageClear(stateRef.current);
          }, discardAnimationDuration);
        } else {
          scheduleSettlementTimer(beginReplenishment, discardAnimationDuration);
        }
      };

      if (playerEchoTriggered) {
        setLogs(prev => [
          ...prev,
          '[羁绊] 触发“极寒回响”',
          '[冰川回收] 请选择 1 张冰川牌保留异变属性',
        ]);
        setGlacierEchoCandidates(playerEchoCandidates);
        continueAfterGlacierEchoRef.current = applyGlacierReturnAndDiscard;
        return;
      }

      applyGlacierReturnAndDiscard();
    };

    scheduleSettlementTimer(() => {
      setClashResult(null);
      scheduleSettlementTimer(startDiscardSequence, 250);
    }, 850);

    setSelectedCards([]);
  }, [activeMutationLabel, activeMutationType, addAnimation, bossPressureBonusDamage, bossPressureThreshold, clearSettlementTimers, completedClashCount, currentAiMaxHP, currentChallengeStage, currentModeConfig.environmentMode, enterChallengeStageClear, faithState.DEER_SPIRIT.level, faithState.FROST_LORD.level, faithState.KITCHEN_GOD.level, finishMutationStage, gameMode, getActiveMutationCandidates, isBossPressureActive, mutationIntervalRounds, mutationLimit, pulseMutationEvent, scheduleSettlementTimer, showMutationPhaseNotice, switchToNextEnvironmentIfNeeded, triggerDeckFeedback]);

  // --- AI LOGIC ---
  const executeAiMove = useCallback(() => {
    if (state.winner || isProcessing || battleFrozenRef.current) return;

    scheduleSettlementTimer(() => {
      if (battleFrozenRef.current) return;
      const aiStageConfig = gameMode === 'CHALLENGE'
        ? getChallengeAiStageConfig(currentChallengeStage)
        : getChallengeAiStageConfig(3);
      let aiRerolledThisTime = false;
      let aiDiscardedCard: Card | null = null;
      let aiDrawnCard: Card | null = null;

      setState(prev => {
        if (prev.winner || (prev.phase !== 'AI_ATTACK' && prev.phase !== 'AI_DEFEND')) return prev;

        let hand = [...prev.aiHand];
        let tempDraw = [...prev.drawPile];
        let tempPlayerDiscard = [...prev.playerDiscardPile];
        let tempAiDiscard = [...prev.aiDiscardPile];
        let aiRerollRecycledOffering = false;
        let aiRerolledText = "";

        // Should AI reroll? Only if there are cards in the public draw pile or recyclable discard piles.
        if (!aiHasRerolledThisTurn && hand.length > 0 && (tempDraw.length > 0 || tempPlayerDiscard.length + tempAiDiscard.length > 0) && Math.random() < aiStageConfig.rerollChance) {
          aiRerolledThisTime = true;
          const discardIndex = Math.floor(Math.random() * hand.length);
          aiDiscardedCard = hand[discardIndex];
          hand.splice(discardIndex, 1);
          tempAiDiscard.push(aiDiscardedCard);

          if (tempDraw.length === 0) {
            const recycle = recycleDiscardPilesIntoSharedDeck({
              playerDiscardPile: tempPlayerDiscard,
              aiDiscardPile: tempAiDiscard,
              playerOfferingPile: prev.playerOfferingPile,
            });
            tempDraw = recycle.recycledDeck;
            tempPlayerDiscard = [];
            tempAiDiscard = [];
            aiRerollRecycledOffering = true;
            setLogs(prevLogs => [
              ...prevLogs,
              '[公共牌库] 牌库已耗尽，开始回收弃牌区',
              `[公共牌库] 回收玩家弃牌区：${prev.playerDiscardPile.length} 张`,
              `[公共牌库] 回收对手弃牌区：${prev.aiDiscardPile.length + 1} 张`,
              `[公共牌库] 回收奉纳区：${prev.playerOfferingPile.length} 张`,
              ...(prev.playerOfferingPile.length > 0 ? ['[公共牌库] 奉纳异变牌已恢复为普通牌'] : []),
              `[公共牌库] 异变牌恢复为普通牌：${recycle.normalizedMutationCount} 张`,
              '[公共牌库] 已重新洗牌',
              `[公共牌库] 当前剩余：${tempDraw.length} 张`,
            ]);
          }

          if (tempDraw.length > 0) {
            aiDrawnCard = tempDraw.shift()!;
            hand.push(aiDrawnCard);
            aiRerolledText = `\n${zhCN.logs.aiReroll}\n${zhCN.logs.sharedDeckChange(prev.drawPile.length, tempDraw.length)}`;
          }
        }

        let played: Card[] = [];
        let nextPhase = prev.phase;
        let nextAction = prev.lastAction;

        if (prev.phase === 'AI_ATTACK') {
          // AI as Home: Play 1-3 identical cards
          const typeGroups: Record<CardType, Card[]> = { ROCK: [], PAPER: [], SCISSORS: [] };
          hand.forEach(c => typeGroups[c.type].push(c));
          
          const availableTypes = CARD_TYPES.filter(t => typeGroups[t].length > 0);
          if (availableTypes.length > 0) {
            const randomType = availableTypes[Math.floor(Math.random() * availableTypes.length)];
            const maxCount = Math.min(typeGroups[randomType].length, aiStageConfig.attackMaxCards);
            const count = maxCount > 1 && Math.random() >= aiStageConfig.preferSingleAttackChance
              ? Math.floor(Math.random() * maxCount) + 1
              : 1;
            played = typeGroups[randomType].slice(0, count);
          } else {
            played = [];
          }

          nextPhase = 'PLAYER_DEFEND';
          nextAction = `${zhCN.logs.aiDeployed(played.length)}\n[系统] 请准备防守${aiRerolledText}`;
          
          return {
            ...prev,
            aiHand: hand.filter(c => !played.find(p => p.id === c.id)),
            homePlayed: played,
            phase: nextPhase,
            lastAction: nextAction,
            drawPile: tempDraw,
            playerDiscardPile: tempPlayerDiscard,
            aiDiscardPile: tempAiDiscard,
            playerOfferingPile: aiRerollRecycledOffering ? [] : prev.playerOfferingPile,
          };
        } 
        
        if (prev.phase === 'AI_DEFEND') {
          // AI as Guest: only use public played count. Card types are face-down here.
          const maxTake = prev.homePlayed.length;
          let takeCount = Math.floor(Math.random() * (maxTake + 1));
          if (maxTake > 0 && Math.random() < aiStageConfig.defendPassChance) {
            takeCount = 0;
          } else if (maxTake > 0 && Math.random() < aiStageConfig.defendFullChance) {
            takeCount = Math.min(maxTake, hand.length);
          }
          
          let selectedToPlay: Card[] = [];
          if (maxTake > 0 && hand.length > 0) {
            selectedToPlay = [...hand]
              .sort(() => Math.random() - 0.5)
              .slice(0, Math.min(takeCount, hand.length));
          }
          played = selectedToPlay;

          nextPhase = 'REVEAL';
          if (played.length > 0) {
            nextAction = `${zhCN.logs.revealingBoth}\n${zhCN.logs.aiDefense(played.length)}${aiRerolledText}`;
          } else {
            nextAction = `${zhCN.logs.aiPass}${aiRerolledText}`;
          }

          return {
            ...prev,
            aiHand: hand.filter(c => !played.find(p => p.id === c.id)),
            guestPlayed: played,
            phase: 'REVEAL',
            lastAction: nextAction,
            drawPile: tempDraw,
            playerDiscardPile: tempPlayerDiscard,
            aiDiscardPile: tempAiDiscard,
            playerOfferingPile: aiRerollRecycledOffering ? [] : prev.playerOfferingPile,
          };
        }

        return prev;
      });

      if (aiRerolledThisTime) {
        setAiHasRerolledThisTurn(true);
        if (aiDiscardedCard) {
          // AI discard: fly from hand (880, 60) to top-right AI discard pile (804, 46)
          addAnimation('DISCARD', 880, 60, 804, 46, (aiDiscardedCard as Card).type);
          setAiDiscardPrompt(`${zhCN.resources.aiDiscard} +1`);
          scheduleSettlementTimer(() => {
            setAiDiscardPrompt(null);
          }, 1500);
        }
        if (aiDrawnCard) {
          scheduleSettlementTimer(() => {
            // AI draw: fly from shared deck (110, 620) to AI hand area (880, 60) face-down
            addAnimation('DRAW_AI', 110, 620, 880, 60, undefined);
            triggerDeckFeedback('敌方重抽', zhCN.logs.aiReroll, '-1');
          }, 250);
        }
      }
    }, 1200);
  }, [state.winner, isProcessing, aiHasRerolledThisTurn, addAnimation, scheduleSettlementTimer, triggerDeckFeedback]);

  // Effect to separate AI execution and Settlement triggering
  useEffect(() => {
    if (state.phase === 'AI_ATTACK' || state.phase === 'AI_DEFEND') {
      executeAiMove();
    }
  }, [state.phase, executeAiMove]);

  useEffect(() => {
    if (state.phase === 'REVEAL') {
      const timer = scheduleSettlementTimer(() => {
        setState(prev => ({
          ...prev,
          phase: 'RESOLVE',
        }));
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [scheduleSettlementTimer, state.phase]);

  useEffect(() => {
    if (state.phase === 'RESOLVE' && !isProcessing) {
      handleSettlement(state.homePlayed, state.guestPlayed);
    }
  }, [state.phase, isProcessing, state.homePlayed, state.guestPlayed, handleSettlement]);


  // --- PLAYER ACTIONS ---
  const onStartRerollMode = () => {
    if (isProcessing || state.winner) return;
    if (playerHasRerolledThisTurn) {
      showShortNotice("每回合最多只能主动弃牌一次");
      return;
    }
    setSelectedCards([]);
    setRerollSelectedCardId(null);
    setIsRerollMode(true);
  };

  const onCancelReroll = () => {
    setIsRerollMode(false);
    setRerollSelectedCardId(null);
  };

  const onConfirmReroll = () => {
    if (!rerollSelectedCardId) {
      showShortNotice("请选择 1 张卡牌进行弃牌");
      return;
    }
    
    const cardToDiscard = state.playerHand.find(c => c.id === rerollSelectedCardId)!;
    
    let tempDraw = [...state.drawPile];
    let tempPlayerDiscard = [...state.playerDiscardPile, cardToDiscard];
    
    // Trigger discard animation from hand: fly from hand (500, 640) to player's discard pile (902, 620)
    addAnimation('DISCARD', 500, 640, 902, 620, cardToDiscard.type);

    setPlayerDiscardPrompt(`${zhCN.resources.playerDiscard} +1`);
    scheduleSettlementTimer(() => {
      setPlayerDiscardPrompt(null);
    }, 1500);

    // Stagger the drawing phase
    scheduleSettlementTimer(() => {
      if (battleFrozenRef.current) return;
      let rerollSnapshot: GameState = {
        ...stateRef.current,
        drawPile: tempDraw,
        playerDiscardPile: tempPlayerDiscard,
      };

      if (rerollSnapshot.drawPile.length === 0) {
        const recycle = tryRecycleSharedDeckState(rerollSnapshot);
        rerollSnapshot = recycle.state;
      }

      if (rerollSnapshot.drawPile.length === 0) {
        setState(prev => {
          const nextState = {
            ...prev,
            playerHand: prev.playerHand.filter(c => c.id !== rerollSelectedCardId),
            drawPile: rerollSnapshot.drawPile,
            playerDiscardPile: rerollSnapshot.playerDiscardPile,
            aiDiscardPile: rerollSnapshot.aiDiscardPile,
            playerOfferingPile: rerollSnapshot.playerOfferingPile,
            lastAction: `[系统] 牌库为空，本次弃牌无法补入新牌`,
          };
          stateRef.current = nextState;
          return nextState;
        });
        setDrawWarningPopUp(true);
      } else {
        const [drawnCard, ...nextDrawPile] = rerollSnapshot.drawPile;
        addAnimation('DRAW_PLAYER', 110, 620, 500, 640, drawnCard.type);
        triggerDeckFeedback('我方重抽', zhCN.logs.playerReroll, '-1');

        setState(prev => {
          const nextHand = prev.playerHand.filter(c => c.id !== rerollSelectedCardId);
          nextHand.push(drawnCard);

          const nextState = {
            ...prev,
            playerHand: nextHand,
            drawPile: nextDrawPile,
            playerDiscardPile: rerollSnapshot.playerDiscardPile,
            aiDiscardPile: rerollSnapshot.aiDiscardPile,
            playerOfferingPile: rerollSnapshot.playerOfferingPile,
            lastAction: `${zhCN.logs.playerReroll}\n${zhCN.logs.sharedDeckChange(prev.drawPile.length, nextDrawPile.length)}`,
          };
          stateRef.current = nextState;
          return nextState;
        });
      }
    }, 300);

    setPlayerHasRerolledThisTurn(true);
    setIsRerollMode(false);
    setRerollSelectedCardId(null);
  };

  const openOfferingPicker = () => {
    if (gameMode !== 'CHALLENGE') return;
    if (!isPlayerTurnState || isProcessing || state.winner || challengeStageClear) {
      showShortNotice('当前阶段不能奉纳');
      return;
    }
    if (hasOfferedThisClash) {
      showShortNotice('本轮已经完成奉纳');
      return;
    }
    if (selectedCards.length !== 1) {
      showShortNotice('请选择 1 张异变牌进行奉纳');
      return;
    }
    const selectedCard = state.playerHand.find(card => card.id === selectedCards[0]);
    if (!selectedCard?.mutationType) {
      showShortNotice('普通牌不能奉纳');
      return;
    }
    if (state.phase === 'PLAYER_ATTACK' && state.playerHand.length <= 1) {
      showShortNotice('至少需要保留 1 张手牌用于出牌');
      return;
    }
    setOfferingPickerCardId(selectedCard.id);
  };

  const confirmOffering = (deityType: DeityType) => {
    if (gameMode !== 'CHALLENGE' || !isPlayerTurnState || hasOfferedThisClash) {
      setOfferingPickerCardId(null);
      return;
    }
    const offeringCard = stateRef.current.playerHand.find(card => card.id === offeringPickerCardId);
    if (!offeringCard?.mutationType) {
      setOfferingPickerCardId(null);
      return;
    }
    if (stateRef.current.phase === 'PLAYER_ATTACK' && stateRef.current.playerHand.length <= 1) {
      showShortNotice('至少需要保留 1 张手牌用于出牌');
      setOfferingPickerCardId(null);
      return;
    }

    const deity = DEITY_CONFIG[deityType];
    const gain = getOfferingFaithGain(offeringCard, deity);
    const cardName = mutationCardLabel(offeringCard.mutationType, offeringCard.type);
    const currentFaith = faithState[deityType];
    const faithBefore = currentFaith.faith;
    const levelBefore = currentFaith.level;
    const faithAfter = faithBefore + gain;
    const levelAfter = getFaithLevel(faithAfter);

    setState(prev => {
      const nextState = {
        ...prev,
        playerHand: prev.playerHand.filter(card => card.id !== offeringCard.id),
        playerOfferingPile: [...prev.playerOfferingPile, offeringCard],
      };
      stateRef.current = nextState;
      return nextState;
    });

    setFaithState(prev => ({
      ...prev,
      [deityType]: {
        faith: faithAfter,
        level: levelAfter,
      },
    }));

    setHasOfferedThisClash(true);
    setSelectedCards([]);
    setOfferingPickerCardId(null);
    showShortNotice(
      levelAfter > levelBefore
        ? `${deity.icon} ${deity.name}升级\nLv.${levelBefore} → Lv.${levelAfter}`
        : `异变牌已奉纳\n${deity.name}信仰 +${gain}`,
      900
    );
    setLogs(prev => [
      ...prev,
      `[奉纳] 玩家将“${cardName}”奉纳给${deity.name}`,
      `[信仰] ${deity.name}信仰：${faithBefore} → ${faithAfter}`,
      ...(levelAfter > levelBefore
        ? [`[神明] ${deity.name}升级：Lv.${levelBefore} → Lv.${levelAfter}`]
        : []),
    ]);
  };

  const releaseCombustion = () => {
    if (gameMode !== 'CHALLENGE' || faithState.KITCHEN_GOD.level < 1) return;
    if (!isPlayerTurnState || isProcessing || state.winner || challengeStageClear) {
      showShortNotice('当前阶段不能释放神明技能');
      return;
    }
    if (hasUsedDeitySkillThisClash) {
      showShortNotice('本轮已经释放神明技能');
      return;
    }
    const scorchBefore = enemyScorchMarksRef.current;
    if (scorchBefore < KITCHEN_GOD_CONFIG.combustionMinimumMarks) {
      showShortNotice(`至少需要 ${KITCHEN_GOD_CONFIG.combustionMinimumMarks} 层灼痕`);
      return;
    }

    const baseDamage = scorchBefore;
    const coreDamage = faithState.KITCHEN_GOD.level >= 4 && !hasTriggeredCoreCombustionThisEnemy
      ? KITCHEN_GOD_CONFIG.coreCombustionBonusDamage
      : 0;
    const damage = baseDamage + coreDamage;
    const snapshot = stateRef.current;
    const nextAiHP = Math.max(0, snapshot.aiHP - damage);
    const retainedScorchMarks = faithState.KITCHEN_GOD.level >= 3 && nextAiHP > 0 ? 1 : 0;
    const nextState: GameState = {
      ...snapshot,
      aiHP: nextAiHP,
    };

    enemyScorchMarksRef.current = retainedScorchMarks;
    setEnemyScorchMarks(retainedScorchMarks);
    setHasUsedDeitySkillThisClash(true);
    if (coreDamage > 0) {
      setHasTriggeredCoreCombustionThisEnemy(true);
    }
    setIsProcessing(true);
    setScorchFeedback({ type: coreDamage > 0 ? 'core' : 'combustion', damage: baseDamage, coreDamage, token: Date.now() });
    setAiHPShake(true);
    setAiHPFlash(true);
    stateRef.current = nextState;
    setState(nextState);
    setLogs(prev => [
      ...prev,
      '[灶神] 释放“爆燃”',
      `[神明伤害] 基础爆燃造成 ${baseDamage} 点伤害`,
      ...(coreDamage > 0
        ? [
            '[灶神] 触发“炉心爆燃”',
            `[神明伤害] 炉心爆燃追加 ${coreDamage} 点伤害`,
          ]
        : []),
      `[灶神] 消耗灼痕：${scorchBefore} → ${retainedScorchMarks}`,
      ...(retainedScorchMarks > 0
        ? [
            '[灶神] 触发“余火”',
            '[灶神] 爆燃后保留 1 层灼痕',
            `[灶神] 敌方灼痕：${scorchBefore} → 1`,
          ]
        : []),
    ]);

    scheduleSettlementTimer(() => {
      setAiHPShake(false);
      setAiHPFlash(false);
    }, 520);

    const feedbackDuration = coreDamage > 0 ? 1180 : 820;
    const emberFeedbackDelay = coreDamage > 0 ? 920 : 620;

    if (retainedScorchMarks > 0) {
      scheduleSettlementTimer(() => {
        setScorchFeedback({ type: 'ember', token: Date.now() });
      }, emberFeedbackDelay);
    }

    scheduleSettlementTimer(() => {
      setScorchFeedback(null);
      if (nextAiHP <= 0) {
        enemyScorchMarksRef.current = 0;
        setEnemyScorchMarks(0);
        setLogs(prev => [...prev, coreDamage > 0 ? '[挑战模式] 当前对手已被炉心爆燃击败' : '[挑战模式] 当前对手已被爆燃击败']);
        if (currentChallengeStage < CHALLENGE_STAGE_CONFIG.totalStages) {
          enterChallengeStageClear(stateRef.current);
          return;
        }

        invalidateBattleSession();
        battleFrozenRef.current = true;
        clearPendingBattleTimers();
        setState(prev => {
          const finalState: GameState = {
            ...prev,
            aiHP: 0,
            phase: 'GAME_OVER',
            homePlayed: [],
            guestPlayed: [],
            winner: 'PLAYER',
          };
          stateRef.current = finalState;
          return finalState;
        });
        setLogs(prev => [
          ...prev,
          `[挑战模式] 第 ${CHALLENGE_STAGE_CONFIG.totalStages} 关完成`,
          '[挑战模式] 挑战通关',
        ]);
        setIsProcessing(false);
        setSettlementSubPhase(null);
        setClashResult(null);
        return;
      }

      setIsProcessing(false);
    }, feedbackDuration);
  };

  const releaseAntlerCharge = (hpCost: number) => {
    if (gameMode !== 'CHALLENGE' || faithState.DEER_SPIRIT.level < 3) return;
    if (!isPlayerTurnState || isProcessing || state.winner || challengeStageClear) {
      showShortNotice('当前阶段不能释放神明技能');
      return;
    }
    if (hasUsedDeitySkillThisClash) {
      showShortNotice('本轮已经释放神明技能');
      return;
    }

    const playerMaxHP = gameMode === 'CHALLENGE' ? playerMaxHpRef.current : INITIAL_HP;
    const isVerdantSurge = faithState.DEER_SPIRIT.level >= 4 && !hasTriggeredVerdantSurgeThisEnemy;
    const safeHpLine = Math.ceil(
      playerMaxHP * (isVerdantSurge ? DEER_SPIRIT_CONFIG.surgeSafeHpRatio : DEER_SPIRIT_CONFIG.chargeSafeHpRatio)
    );
    const snapshot = stateRef.current;
    const maxAllowedCost = Math.min(
      isVerdantSurge ? DEER_SPIRIT_CONFIG.surgeMaxHpCost : DEER_SPIRIT_CONFIG.chargeMaxHpCost,
      Math.max(0, snapshot.playerHP - safeHpLine)
    );
    if (hpCost < 1 || hpCost > maxAllowedCost) {
      showShortNotice(maxAllowedCost <= 0 ? '当前生命不足以发动鹿角奔袭' : '请选择可承受的生命消耗');
      return;
    }

    const damage = hpCost * DEER_SPIRIT_CONFIG.chargeDamagePerHp;
    const nextPlayerHP = Math.max(safeHpLine, snapshot.playerHP - hpCost);
    const nextAiHP = Math.max(0, snapshot.aiHP - damage);
    const nextState: GameState = {
      ...snapshot,
      playerHP: nextPlayerHP,
      aiHP: nextAiHP,
    };

    stateRef.current = nextState;
    setState(nextState);
    setHasUsedDeitySkillThisClash(true);
    if (isVerdantSurge) {
      setHasTriggeredVerdantSurgeThisEnemy(true);
    }
    setAntlerChargePickerOpen(false);
    setSelectedCards([]);
    setAntlerChargeFeedback({ hpCost, damage, isSurge: isVerdantSurge, token: Date.now() });
    setPlayerHPFlash(true);
    setAiHPShake(true);
    setAiHPFlash(true);
    setLogs(prev => [
      ...prev,
      '[鹿灵] 释放“鹿角奔袭”',
      ...(isVerdantSurge ? ['[鹿灵] 触发“万木奔涌”'] : []),
      `[生命转化] 玩家消耗 ${hpCost} 点生命：${snapshot.playerHP} → ${nextPlayerHP}`,
      `[神明伤害] ${isVerdantSurge ? '万木奔涌' : '鹿角奔袭'}造成 ${damage} 点伤害`,
    ]);

    scheduleSettlementTimer(() => {
      setPlayerHPFlash(false);
      setAiHPShake(false);
      setAiHPFlash(false);
      setAntlerChargeFeedback(null);
    }, 900);

    if (nextAiHP <= 0) {
      setLogs(prev => [...prev, `[挑战模式] 当前对手已被${isVerdantSurge ? '万木奔涌' : '鹿角奔袭'}击败`]);
      setIsProcessing(true);
      scheduleSettlementTimer(() => {
        if (currentChallengeStage < CHALLENGE_STAGE_CONFIG.totalStages) {
          enterChallengeStageClear(stateRef.current);
          return;
        }

        invalidateBattleSession();
        battleFrozenRef.current = true;
        clearPendingBattleTimers();
        enemyScorchMarksRef.current = 0;
        setEnemyScorchMarks(0);
        setScorchFeedback(null);
        setHasTriggeredCoreCombustionThisEnemy(false);
        setHasTriggeredVerdantSurgeThisEnemy(false);
        setAntlerChargeFeedback(null);
        setState(prev => {
          const finalState: GameState = {
            ...prev,
            aiHP: 0,
            phase: 'GAME_OVER',
            homePlayed: [],
            guestPlayed: [],
            winner: 'PLAYER',
          };
          stateRef.current = finalState;
          return finalState;
        });
        setLogs(prev => [
          ...prev,
          `[挑战模式] 第 ${CHALLENGE_STAGE_CONFIG.totalStages} 关完成`,
          '[挑战模式] 挑战通关',
        ]);
        setIsProcessing(false);
        setSettlementSubPhase(null);
        setClashResult(null);
      }, 700);
    }
  };

  const releaseFrostSigils = (sigilsToRelease: number) => {
    if (gameMode !== 'CHALLENGE' || faithState.FROST_LORD.level < 1) return;
    if (!isPlayerTurnState || isProcessing || state.winner || challengeStageClear) {
      showShortNotice('当前阶段不能释放神明技能');
      return;
    }
    if (hasUsedDeitySkillThisClash) {
      showShortNotice('本轮已经释放神明技能');
      return;
    }
    const availableSigils = playerFrostSigilsRef.current;
    if (sigilsToRelease < 1 || sigilsToRelease > availableSigils) {
      showShortNotice('请选择当前拥有的霜签数量');
      return;
    }

    const triggersColdWave = faithState.FROST_LORD.level >= 3
      && sigilsToRelease >= FROST_LORD_CONFIG.coldWaveMinimumSigils;
    const triggersBlizzard = faithState.FROST_LORD.level >= 4
      && !hasTriggeredBlizzardThisEnemy
      && sigilsToRelease === FROST_LORD_CONFIG.blizzardFullReleaseSigils;
    const temporarySigils = (triggersColdWave ? FROST_LORD_CONFIG.coldWaveTemporarySigils : 0)
      + (triggersBlizzard ? FROST_LORD_CONFIG.blizzardTemporarySigils : 0);
    const totalHits = sigilsToRelease + temporarySigils;
    const totalDamage = totalHits * FROST_LORD_CONFIG.damagePerSigil;
    const snapshot = stateRef.current;
    const nextAiHP = Math.max(0, snapshot.aiHP - totalDamage);
    const nextSigils = availableSigils - sigilsToRelease;
    const nextState: GameState = {
      ...snapshot,
      aiHP: nextAiHP,
    };

    playerFrostSigilsRef.current = nextSigils;
    setPlayerFrostSigils(nextSigils);
    setHasUsedDeitySkillThisClash(true);
    if (triggersBlizzard) {
      setHasTriggeredBlizzardThisEnemy(true);
    }
    setFrostSigilPickerOpen(false);
    setSelectedCards([]);
    setIsProcessing(true);
    setAiHPShake(true);
    setAiHPFlash(true);
    stateRef.current = nextState;
    setState(nextState);
    setLogs(prev => [
      ...prev,
      `[霜君] 释放 ${sigilsToRelease} 枚霜签`,
      ...(triggersColdWave
        ? ['[霜君] 触发“寒潮”', '[神明伤害] 追加 1 枚临时霜签']
        : []),
      ...(triggersBlizzard
        ? ['[霜君] 触发“暴雪”', '[神明伤害] 追加 2 枚临时霜签']
        : []),
      `[神明伤害] 霜签连续造成 ${totalHits} 点伤害`,
    ]);

    for (let hitIndex = 1; hitIndex <= totalHits; hitIndex += 1) {
      scheduleSettlementTimer(() => {
        setFrostSigilFeedback({ hitIndex, totalHits, token: Date.now() + hitIndex });
      }, (hitIndex - 1) * 150);
    }

    scheduleSettlementTimer(() => {
      setAiHPShake(false);
      setAiHPFlash(false);
      setFrostSigilFeedback(null);
      if (nextAiHP <= 0) {
        setLogs(prev => [...prev, '[挑战模式] 当前对手已被霜签击败']);
        if (currentChallengeStage < CHALLENGE_STAGE_CONFIG.totalStages) {
          enterChallengeStageClear(stateRef.current);
          return;
        }

        invalidateBattleSession();
        battleFrozenRef.current = true;
        clearPendingBattleTimers();
        enemyScorchMarksRef.current = 0;
        setEnemyScorchMarks(0);
        setScorchFeedback(null);
        setHasTriggeredCoreCombustionThisEnemy(false);
        setHasTriggeredVerdantSurgeThisEnemy(false);
        setHasTriggeredBlizzardThisEnemy(false);
        setState(prev => {
          const finalState: GameState = {
            ...prev,
            aiHP: 0,
            phase: 'GAME_OVER',
            homePlayed: [],
            guestPlayed: [],
            winner: 'PLAYER',
          };
          stateRef.current = finalState;
          return finalState;
        });
        setLogs(prev => [
          ...prev,
          `[挑战模式] 第 ${CHALLENGE_STAGE_CONFIG.totalStages} 关完成`,
          '[挑战模式] 挑战通关',
        ]);
        setIsProcessing(false);
        setSettlementSubPhase(null);
        setClashResult(null);
        return;
      }

      setIsProcessing(false);
    }, Math.max(760, totalHits * 150 + 260));
  };

  const onPlay = () => {
    if (isProcessing || state.winner) return;

    const selected = state.playerHand.filter(c => selectedCards.includes(c.id));
    
    if (state.phase === 'PLAYER_ATTACK') {
      if (selected.length === 0 || selected.length > 3) {
        showShortNotice("主场连击必须使用 1~3 张卡牌");
        return;
      }
      const firstType = selected[0].type;
      const allSame = selected.every(c => c.type === firstType);
      if (!allSame) {
        showShortNotice("主场连击必须使用相同属性卡牌");
        return;
      }

      setState(prev => ({
        ...prev,
        playerHand: prev.playerHand.filter(c => !selectedCards.includes(c.id)),
        homePlayed: selected,
        phase: 'AI_DEFEND',
        lastAction: zhCN.logs.playerDeployed(selected.length, cardLabel(selected[0].type)),
      }));
    } else if (state.phase === 'PLAYER_DEFEND') {
      const maxTake = state.homePlayed.length;
      if (selected.length > maxTake) {
        showShortNotice(`最多只能选择 ${maxTake} 张防守牌`);
        return;
      }

      setState(prev => ({
        ...prev,
        playerHand: prev.playerHand.filter(c => !selectedCards.includes(c.id)),
        guestPlayed: selected,
        phase: 'REVEAL',
        lastAction: selected.length > 0
          ? `${zhCN.logs.revealingBoth}\n${zhCN.logs.playerDefense(selected.length)}`
          : zhCN.logs.playerPass,
      }));
    }
    setSelectedCards([]);
  };

  const onAbandonDefense = () => {
    if (isProcessing || state.winner || state.phase !== 'PLAYER_DEFEND') return;

    if (selectedCards.length > 0) {
      showShortNotice('请先取消已选择的防守牌', 1200);
      return;
    }

    showShortNotice('玩家放弃防守', 700);
    setState(prev => ({
      ...prev,
      guestPlayed: [],
      phase: 'REVEAL',
      lastAction: zhCN.logs.playerPass,
    }));
    setSelectedCards([]);
  };

  const toggleSelect = (id: string) => {
    if (isRerollMode) {
      setRerollSelectedCardId(prev => prev === id ? null : id);
      return;
    }

    if (selectedCards.includes(id)) {
      setSelectedCards(prev => prev.filter(i => i !== id));
      return;
    }

    const card = state.playerHand.find(c => c.id === id)!;

    if (state.phase === 'PLAYER_ATTACK') {
      if (selectedCards.length > 0) {
        const firstCard = state.playerHand.find(c => c.id === selectedCards[0])!;
        if (firstCard.type !== card.type) {
          showShortNotice("主场连击必须使用相同属性卡牌");
          return;
        }
      }
      if (selectedCards.length >= 3) {
        showShortNotice("最多只能选择 3 张进攻牌");
        return;
      }
    }

    if (state.phase === 'PLAYER_DEFEND') {
      const maxTake = state.homePlayed.length;
      if (selectedCards.length >= maxTake) {
        triggerCardShake(id);
        triggerDefenseLimitNotice(maxTake);
        setLogs(prev => [
          ...prev,
          `[警告] ${zhCN.notices.maxDefenseCards(maxTake)}`
        ]);
        return;
      }
    }

    setSelectedCards(prev => [...prev, id]);
  };

  const isPlayerTurnState = (state.phase === 'PLAYER_ATTACK' || state.phase === 'PLAYER_DEFEND') && !isProcessing && !challengeStageClear;
  const playerMutationCount = countAllMutatedCards(state.playerHand);
  const aiMutationCount = countAllMutatedCards(state.aiHand);
  const selectedVolcanoCards = state.playerHand.filter(card =>
    selectedCards.includes(card.id) && card.mutationType === 'VOLCANO'
  );
  const selectedMatureForestCards = state.playerHand.filter(card =>
    selectedCards.includes(card.id) && isMatureForestCard(card)
  );
  const selectedGlacierCards = state.playerHand.filter(card =>
    selectedCards.includes(card.id) && card.mutationType === 'GLACIER'
  );
  const selectedOfferingCard = selectedCards.length === 1
    ? state.playerHand.find(card => card.id === selectedCards[0]) ?? null
    : null;
  const canShowOfferingAction = gameMode === 'CHALLENGE'
    && isPlayerTurnState
    && !isRerollMode
    && selectedCards.length === 1
    && Boolean(selectedOfferingCard?.mutationType);
  const canShowCombustionAction = gameMode === 'CHALLENGE'
    && faithState.KITCHEN_GOD.level >= 1
    && isPlayerTurnState
    && !isRerollMode;
  const combustionDisabledReason = hasUsedDeitySkillThisClash
    ? '本轮已经释放神明技能'
    : enemyScorchMarks < KITCHEN_GOD_CONFIG.combustionMinimumMarks
      ? `至少需要 ${KITCHEN_GOD_CONFIG.combustionMinimumMarks} 层灼痕`
      : null;
  const canUseVerdantSurge = gameMode === 'CHALLENGE'
    && faithState.DEER_SPIRIT.level >= 4
    && !hasTriggeredVerdantSurgeThisEnemy;
  const antlerChargeSafeHpRatio = canUseVerdantSurge
    ? DEER_SPIRIT_CONFIG.surgeSafeHpRatio
    : DEER_SPIRIT_CONFIG.chargeSafeHpRatio;
  const antlerChargeMaxHpCost = canUseVerdantSurge
    ? DEER_SPIRIT_CONFIG.surgeMaxHpCost
    : DEER_SPIRIT_CONFIG.chargeMaxHpCost;
  const activePlayerMaxHp = gameMode === 'CHALLENGE' ? playerMaxHp : INITIAL_HP;
  const deerChargeSafeHpLine = Math.ceil(activePlayerMaxHp * antlerChargeSafeHpRatio);
  const maxAntlerChargeHpCost = Math.min(
    antlerChargeMaxHpCost,
    Math.max(0, state.playerHP - deerChargeSafeHpLine)
  );
  const canShowAntlerChargeAction = gameMode === 'CHALLENGE'
    && faithState.DEER_SPIRIT.level >= 3
    && isPlayerTurnState
    && !isRerollMode;
  const antlerChargeDisabledReason = hasUsedDeitySkillThisClash
    ? '本轮已经释放神明技能'
    : maxAntlerChargeHpCost <= 0
      ? '当前生命不足以发动鹿角奔袭'
      : null;
  useEffect(() => {
    if (!canShowAntlerChargeAction || antlerChargeDisabledReason) {
      setAntlerChargePickerOpen(false);
    }
  }, [antlerChargeDisabledReason, canShowAntlerChargeAction]);
  const canShowFrostSigilAction = gameMode === 'CHALLENGE'
    && faithState.FROST_LORD.level >= 1
    && isPlayerTurnState
    && !isRerollMode;
  const frostSigilDisabledReason = hasUsedDeitySkillThisClash
    ? '本轮已经释放神明技能'
    : playerFrostSigils <= 0
      ? '当前没有霜签'
      : null;
  useEffect(() => {
    if (!canShowFrostSigilAction || frostSigilDisabledReason) {
      setFrostSigilPickerOpen(false);
    }
  }, [canShowFrostSigilAction, frostSigilDisabledReason]);
  const hasRecoverableDiscardPile = state.playerDiscardPile.length + state.aiDiscardPile.length + state.playerOfferingPile.length > 0;
  const isSharedDeckUnavailable = state.drawPile.length === 0 && !hasRecoverableDiscardPile;
  const showResonancePreview = selectedVolcanoCards.length >= 2 && !isRerollMode && isPlayerTurnState;
  const showSymbiosisPreview = selectedMatureForestCards.length >= 2 && !isRerollMode && isPlayerTurnState;
  const showGlacierEchoPreview = selectedGlacierCards.length >= 2 && !isRerollMode && isPlayerTurnState;
  const mutationRoundsRemaining = state.drawPile.length === 0
    ? 0
    : mutationIntervalRounds - completedClashesSinceMutation;
  const isMutationImminent = state.phase === 'RESOLVE'
    && completedClashesSinceMutation === mutationIntervalRounds - 1
    && state.drawPile.length > 0;
  const isMutationProcessing = mutationCandidates.length > 0 || mutationAnimation !== null;
  const mutationEventStatus = state.drawPile.length === 0
    ? '感染已停止'
    : isMutationProcessing
      ? '感染处理中'
      : isMutationImminent
      ? '本轮结束后触发感染'
      : `下一次感染：${mutationRoundsRemaining} 轮后`;

  useEffect(() => {
    if (state.phase === 'PLAYER_ATTACK' || state.phase === 'PLAYER_DEFEND') {
      setPlayerHasRerolledThisTurn(false);
    }
    if (state.phase === 'AI_ATTACK' || state.phase === 'AI_DEFEND') {
      setAiHasRerolledThisTurn(false);
    }
  }, [state.phase]);

  useEffect(() => {
    if (state.drawPile.length === 0 && screen === 'BATTLE') {
      setShowDepletedNotification(true);
      if (!hasLoggedDepletion) {
        setHasLoggedDepletion(true);
        setLogs(prev => [
          ...prev,
          zhCN.logs.sharedDeckDepleted
        ]);
      }
      const timer = setTimeout(() => {
        setShowDepletedNotification(false);
      }, 1500); // Between 1.2s and 1.8s
      return () => clearTimeout(timer);
    } else if (state.drawPile.length > 0) {
      setHasLoggedDepletion(false);
      setShowDepletedNotification(false);
    }
  }, [state.drawPile.length, screen, hasLoggedDepletion]);

  const getPhaseIndicator = () => {
    let titleEng = zhCN.phases.idle;
    let titleChn = "等待下一步操作";
    let type: 'green' | 'amber' | 'blue' | 'gray' | 'red' = 'gray';
    let pulse = false;
    let bounce = false;

    if (mutationPhaseNotice) {
      titleEng = activeEnvironmentConfig.name;
      titleChn = mutationPhaseNotice;
      type = 'green';
      pulse = true;
    }
    else if (state.drawPile.length === 0 && showDepletedNotification) {
      titleEng = zhCN.phases.deckDepleted;
      titleChn = "公共牌库已耗尽，进入最终交锋";
      type = 'red';
      pulse = true;
    }
    else if (isRerollMode) {
      titleEng = zhCN.phases.rerollMode;
      titleChn = "请选择 1 张需要弃掉的手牌";
      type = 'amber';
      pulse = true;
    }
    else if (state.playerRole === 'HOME' && state.phase === 'PLAYER_ATTACK') {
      titleEng = zhCN.phases.playerHomeTurn;
      titleChn = "玩家主场：请选择 1~3 张相同类型卡牌进攻";
      type = 'green';
    } 
    else if (state.playerRole === 'HOME' && state.phase === 'AI_DEFEND') {
      titleEng = zhCN.phases.aiDefending;
      titleChn = "对手正在防守";
      type = 'amber';
      pulse = true;
      bounce = true;
    }
    else if (state.aiRole === 'HOME' && state.phase === 'PLAYER_DEFEND') {
      titleEng = zhCN.phases.playerDefenseTurn;
      titleChn = `玩家客场：对手已暗扣 ${state.homePlayed.length} 张牌，请选择 0~${state.homePlayed.length} 张卡牌防守`;
      type = 'green';
    }
    else if (state.phase === 'REVEAL') {
      titleEng = zhCN.phases.revealPhase;
      titleChn = "双方翻牌";
      type = 'blue';
    }
    else if (state.phase === 'RESOLVE' && settlementSubPhase === 'resolving') {
      titleEng = zhCN.phases.resolving;
      titleChn = "伤害结算";
      type = 'blue';
    }
    else if (state.phase === 'RESOLVE' && settlementSubPhase === 'move-to-discard') {
      titleEng = zhCN.phases.discardPhase;
      titleChn = "卡牌进入弃牌区";
      type = 'blue';
    }
    else if (state.phase === 'RESOLVE' && settlementSubPhase === 'replenishing') {
      titleEng = zhCN.phases.replenishPhase;
      titleChn = "补牌阶段";
      type = 'blue';
    }
    else if (state.phase === 'RESOLVE' && settlementSubPhase === 'replenish-complete') {
      titleEng = zhCN.phases.replenishComplete;
      titleChn = "补牌阶段";
      type = 'blue';
    }
    else if (state.phase === 'RESOLVE' && settlementSubPhase === 'round-end') {
      titleEng = zhCN.phases.roundEnd;
      titleChn = "本轮结束";
      type = 'gray';
    }
    else if (state.phase === 'AI_ATTACK') {
      titleEng = zhCN.phases.aiHomeTurn;
      titleChn = "对手正在选择攻击牌...";
      type = 'amber';
      pulse = true;
      bounce = true;
    }

    return { titleEng, titleChn, type, pulse, bounce };
  };

  if (screen === 'HOME') {
    return (
      <div className="w-[1024px] h-[768px] mx-auto bg-bg text-text-main flex flex-col font-sans border border-border overflow-hidden relative shadow-2xl select-none">
        {/* Scanline / Grid Effect overlay (pure aesthetic backdrops) */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90.1deg,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:100%_4px,32px_32px,32px_32px] pointer-events-none opacity-20" />

        {/* Header */}
        <div className="h-20 px-10 flex items-center justify-between border-b border-border bg-surface/80 backdrop-blur-md z-20">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-mono text-[#10b981]/80 tracking-[1px] select-none">{zhCN.home.systemOnline}</span>
          </div>

          <div className="text-center select-none">
            <div className="text-2xl font-black tracking-[4px] leading-tight select-none">战术猜拳</div>
            <div className="text-[10px] text-accent font-bold tracking-widest font-mono">{zhCN.home.lobbySubtitle}</div>
          </div>

          {/* Top Right Controls */}
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsMuted(prev => !prev)}
              className="w-9 h-9 rounded-lg border border-border bg-[#18181c] flex items-center justify-center text-text-dim hover:text-white hover:border-text-dim/50 cursor-pointer transition-all active:scale-95"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-red-500/80" /> : <Volume2 className="w-4 h-4 text-emerald-500/80" />}
            </button>
            <button 
              className="w-9 h-9 rounded-lg border border-border bg-[#18181c] flex items-center justify-center text-text-dim hover:text-white hover:border-text-dim/50 cursor-pointer transition-all active:scale-95"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Central visual header & Float group */}
        <div className="flex-1 flex flex-col justify-center py-4 relative z-10">
          <div className="text-center mb-1 select-none">
            <h1 className="text-4xl font-extrabold tracking-[6px] text-white">{zhCN.home.protocolTitle}</h1>
            <p className="text-[10px] font-mono text-text-dim/60 tracking-[4px] mt-1">{zhCN.home.protocolHint}</p>
          </div>

          {/* Cards Stack */}
          <motion.div 
            className="relative w-[300px] h-[190px] flex items-center justify-center mx-auto"
            animate={{ y: [0, -8, 0] }}
            transition={{ repeat: Infinity, duration: 4.5, ease: "easeInOut" }}
          >
            {/* Rock Card */}
            <div className="absolute w-[100px] h-[140px] rounded-xl bg-[#141417] border border-rock/20 flex flex-col items-center justify-center shadow-lg -translate-x-[75px] rotate-[-10deg] transition-all">
              <div className="text-4xl mb-2 text-rock select-none">✊</div>
              <span className="text-[10px] font-mono font-black tracking-widest text-[#3b82f6]/70">{zhCN.cards.ROCK}</span>
              <span className="text-[8px] font-mono text-text-dim/30 mt-1">战术单元 01</span>
            </div>

            {/* Scissors Card */}
            <div className="absolute w-[105px] h-[148px] rounded-xl bg-[#17171c] border border-scissors/30 flex flex-col items-center justify-center shadow-2xl -translate-y-2 rotate-0 transition-all">
              <div className="text-[44px] mb-2 text-scissors select-none">✌️</div>
              <span className="text-[11px] font-mono font-black tracking-widest text-[#ef4444]/85">{zhCN.cards.SCISSORS}</span>
              <span className="text-[8px] font-mono text-text-dim/40 mt-1">战术单元 03</span>
            </div>

            {/* Paper Card */}
            <div className="absolute w-[100px] h-[140px] rounded-xl bg-[#141417] border border-paper/20 flex flex-col items-center justify-center shadow-lg translate-x-[75px] rotate-[10deg] transition-all">
              <div className="text-4xl mb-2 text-paper select-none">✋</div>
              <span className="text-[10px] font-mono font-black tracking-widest text-[#10b981]/70">{zhCN.cards.PAPER}</span>
              <span className="text-[8px] font-mono text-text-dim/30 mt-1">战术单元 02</span>
            </div>
          </motion.div>

          {/* Operational modes */}
          <div className="flex justify-center gap-6 px-10 select-none mt-2">
            {/* Mode 1: Quick Match */}
            <div 
              onClick={() => {
                if (selectedProtocol !== 'QUICK') {
                  setSelectedProtocol('QUICK');
                  setHomeLogs(prev => [
                    ...prev,
                    zhCN.logs.quickSelected,
                    zhCN.logs.readyToInitialize,
                  ]);
                }
              }}
              className={`w-[275px] p-5 rounded-xl border bg-[#111114] flex flex-col justify-between transition-all duration-300 cursor-pointer ${
                selectedProtocol === 'QUICK' 
                  ? 'border-accent shadow-[0_0_25px_rgba(245,158,11,0.18)] bg-[#17171d]' 
                  : 'border-[#2d2d35]/65 hover:border-[#2d2d35]/100'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3 text-[9px] font-bold font-mono">
                  <span className="text-[#10b981] bg-[#10b981]/10 px-2 py-0.5 rounded-full tracking-wider">{zhCN.home.available}</span>
                  <span className="text-accent/60 font-mono">协议 01</span>
                </div>
                <h3 className={`text-[15px] font-black tracking-wide uppercase transition-colors ${
                  selectedProtocol === 'QUICK' ? 'text-accent' : 'text-[#fff]'
                }`}>
                  {zhCN.home.quickMatch}
                </h3>
                <p className="text-[11px] font-medium text-text-dim/80 mt-1 mb-5 leading-normal">
                  {zhCN.home.quickMatch}
                  <span className="block text-[10px] text-text-dim/50 mt-1">单一火山环境，适合快速体验基础异变牌玩法</span>
                </p>
              </div>

              <button
                disabled={selectedProtocol !== 'QUICK'}
                onClick={(e) => {
                  e.stopPropagation();
                  setHomeLogs(prev => [
                    ...prev,
                    zhCN.logs.initializingBattlefield,
                  ]);
                  setTimeout(() => {
                    resetGame('QUICK');
                    setScreen('BATTLE');
                  }, 800);
                }}
                className={`w-full py-2.5 rounded-lg text-xs font-black tracking-widest uppercase transition-all duration-300 cursor-pointer disabled:cursor-not-allowed ${
                  selectedProtocol === 'QUICK'
                    ? 'bg-accent text-black hover:opacity-90 active:scale-[0.98] shadow-lg shadow-accent/15 font-black'
                    : 'bg-[#1e1e24] text-text-dim/20 border border-[#2d2d35]/40'
                }`}
              >
                {zhCN.home.startBattle}
              </button>
            </div>

            {/* Mode 2: Training */}
            <div 
              onClick={() => {
                setHomeLogs(prev => [
                  ...prev,
                  zhCN.logs.protocolUnavailable,
                ]);
              }}
              className="w-[275px] p-5 rounded-xl border border-blue-900/35 bg-[#0e121b] flex flex-col justify-between transition-all duration-300 opacity-75 hover:border-blue-700/50 group select-none cursor-pointer"
            >
              <div>
                <div className="flex items-center justify-between mb-3 text-[9px] font-bold font-mono">
                  <span className="text-blue-400/80 bg-blue-950/55 border border-blue-900/40 px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center">
                    <Lock className="w-2.5 h-2.5 mr-1 text-blue-400/70" />
                    {zhCN.home.locked}
                  </span>
                  <span className="text-blue-500/50 font-mono font-bold">协议 02</span>
                </div>
                <h3 className="text-[15px] font-black tracking-wide text-blue-400/90 uppercase transition-colors">
                  {zhCN.home.training}
                </h3>
                <p className="text-[11px] font-medium text-text-dim/70 mt-1 mb-5 leading-normal">
                  {zhCN.home.training}
                  <span className="block text-[10px] text-blue-500/45 mt-1">{zhCN.home.trainingDescription}</span>
                </p>
              </div>

              <button
                disabled
                className="w-full py-2.5 rounded-lg text-xs font-black tracking-widest uppercase bg-blue-950/20 text-blue-400/35 border border-blue-900/30 cursor-not-allowed"
              >
                {zhCN.home.startBattle}
              </button>
            </div>

            {/* Mode 3: Challenge */}
            <div 
              onClick={() => {
                if (selectedProtocol !== 'CHALLENGE') {
                  setSelectedProtocol('CHALLENGE');
                  setHomeLogs(prev => [
                    ...prev,
                    '[系统] 已选择挑战模式',
                    zhCN.logs.readyToInitialize,
                  ]);
                }
              }}
              className={`w-[275px] p-5 rounded-xl border bg-[#130c16] flex flex-col justify-between transition-all duration-300 cursor-pointer ${
                selectedProtocol === 'CHALLENGE'
                  ? 'border-fuchsia-400/70 shadow-[0_0_25px_rgba(217,70,239,0.16)] bg-[#190f1d]'
                  : 'border-fuchsia-950/45 hover:border-fuchsia-700/50'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3 text-[9px] font-bold font-mono">
                  <span className="text-fuchsia-300 bg-fuchsia-500/10 border border-fuchsia-500/30 px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center">
                    {zhCN.home.available}
                  </span>
                  <span className="text-fuchsia-500/50 font-mono font-bold">协议 03</span>
                </div>
                <h3 className={`text-[15px] font-black tracking-wide uppercase transition-colors ${
                  selectedProtocol === 'CHALLENGE' ? 'text-fuchsia-200' : 'text-fuchsia-400/90'
                }`}>
                  {zhCN.home.challenge}
                </h3>
                <p className="text-[11px] font-medium text-text-dim/70 mt-1 mb-5 leading-normal">
                  {zhCN.home.challenge}
                  <span className="block text-[10px] text-fuchsia-300/55 mt-1">火山、森林与冰川循环轮替，适合体验多环境构筑</span>
                </p>
              </div>

              {hasValidChallengeSave ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startNewChallengeRun();
                    }}
                    className="py-2.5 rounded-lg text-[11px] font-black tracking-widest uppercase transition-all duration-300 cursor-pointer bg-fuchsia-300 text-black hover:opacity-90 active:scale-[0.98] shadow-lg shadow-fuchsia-500/15"
                  >
                    重新开始
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      continueSavedChallengeRun();
                    }}
                    className="py-2.5 rounded-lg text-[11px] font-black tracking-widest uppercase transition-all duration-300 cursor-pointer bg-cyan-300 text-black hover:opacity-90 active:scale-[0.98] shadow-lg shadow-cyan-500/15"
                  >
                    继续作战
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startNewChallengeRun();
                  }}
                  className="w-full py-2.5 rounded-lg text-xs font-black tracking-widest uppercase transition-all duration-300 cursor-pointer bg-fuchsia-300 text-black hover:opacity-90 active:scale-[0.98] shadow-lg shadow-fuchsia-500/15"
                >
                  开始作战
                </button>
              )}
            </div>
          </div>

          {/* Console System Logs Box */}
          <div className="px-10 mt-5 flex justify-center">
            <div 
              ref={homeLogContainerRef}
              className="w-[858px] h-[105px] bg-[#070709]/90 backdrop-blur-md rounded-xl p-3 text-[11px] overflow-y-auto border border-[#2d2d35]/85 custom-scrollbar flex flex-col gap-1 scroll-smooth font-mono"
            >
              <div className="font-bold text-accent uppercase text-[9px] tracking-widest sticky top-0 bg-[#070709] pb-1 border-b border-border/30 z-10 flex justify-between items-center select-none">
                <span>{zhCN.home.consoleTitle}</span>
                <span className="text-text-dim/30 text-[8px] font-normal">{zhCN.home.consoleSession}</span>
              </div>
              <div className="flex flex-col gap-0.5 pt-1">
                {homeLogs.map((log, index) => {
                  const isWarn = log.includes('尚未开放');
                  const isInit = log.includes('初始化');
                  const isSel = log.includes('已选择') || log.includes('准备');
                  
                  let textColor = 'text-text-dim/70';
                  if (isWarn) textColor = 'text-[#f59e0b] font-bold';
                  else if (isInit) textColor = 'text-[#10b981] animate-pulse font-medium';
                  else if (isSel) textColor = 'text-[#3b82f6]';
                  
                  return (
                    <div key={index} className={`leading-relaxed text-[10.5px] pb-0.5 border-b border-white/[0.01] last:border-b-0 ${textColor}`}>
                      <span className="text-[8.5px] text-white/10 mr-1.5">[{index + 1}]</span>
                      {log}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <style>{`
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #2d2d35; border-radius: 2px; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] h-screen min-h-[720px] mx-auto bg-bg text-text-main flex flex-col font-sans border border-border overflow-hidden relative shadow-2xl">
      {/* Header */}
      <div className="h-20 px-10 flex items-center justify-between border-b border-border bg-surface/80 backdrop-blur-md z-20">
        <div className={`relative w-[300px] p-1 rounded-lg transition-all duration-350 border border-transparent ${playerHPShake ? 'animate-hp-shake' : ''} ${burnFeedback?.targets.includes('PLAYER') ? 'burn-hp-feedback animate-burn-hp-shake' : ''} ${forestRecoveryFeedback?.recoveryByTarget.PLAYER ? 'forest-recovery-hp-feedback' : ''} ${playerHPFlash ? 'bg-red-500/10 border-red-500/35 shadow-[0_0_15px_rgba(239,68,68,0.15)] bg-opacity-30' : ''}`}>
          <div className="text-[12px] mb-1 text-text-dim tracking-wider">玩家</div>
          <div className="w-full h-3 bg-[#222] rounded-full overflow-hidden border border-[#333]">
            <motion.div 
              initial={false}
              animate={{ width: `${(state.playerHP / activePlayerMaxHp) * 100}%` }}
              className="h-full hp-bar-gradient-player"
            />
          </div>
          <div className="flex justify-between mt-1 items-center font-mono opacity-80">
            <span className="text-sm">
              {state.playerHP}/{activePlayerMaxHp}
              {forestRecoveryFeedback?.recoveryByTarget.PLAYER ? (
                <span className="ml-2 text-[11px] font-black text-emerald-300 drop-shadow-[0_0_7px_rgba(52,211,153,0.55)]">+{forestRecoveryFeedback.recoveryByTarget.PLAYER}</span>
              ) : null}
            </span>
            <span className="text-[10px]">生命</span>
          </div>
          {gameMode === 'CHALLENGE' && (
            <div className="mt-1 flex justify-between text-[9px] font-mono font-bold text-white/48">
              <span>{`护盾：${playerShield} / ${CHALLENGE_REWARD_CONFIG.shieldLimit}`}</span>
              <span>{`手牌槽：${playerHandLimit}`}</span>
            </div>
          )}
          <AnimatePresence>
            {burnFeedback?.targets.includes('PLAYER') && (
              <motion.div
                key={`player-burn-${burnFeedback.token}`}
                initial={{ opacity: 0, y: 4, scale: 0.92 }}
                animate={{ opacity: [0, 1, 1, 0], y: [4, -18, -32], scale: [0.92, 1.04, 1] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.72, ease: 'easeOut' }}
                className="absolute left-2 -top-1 rounded-md border border-orange-500/35 bg-black/75 px-2 py-1 font-mono text-[11px] font-black text-orange-300 shadow-[0_0_18px_rgba(249,115,22,0.25)] pointer-events-none"
              >
                {VOLCANO_ENVIRONMENT_CONFIG.icon} 灼烧共鸣 -{VOLCANO_ENVIRONMENT_CONFIG.resonanceBonusDamage}
                <span className="absolute -right-3 top-2 text-[10px] opacity-80">{VOLCANO_ENVIRONMENT_CONFIG.icon}</span>
                <span className="absolute right-5 -top-2 text-[8px] opacity-60">{VOLCANO_ENVIRONMENT_CONFIG.icon}</span>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {forestRecoveryFeedback?.targets.includes('PLAYER') && (
              <motion.div
                key={`player-forest-recovery-${forestRecoveryFeedback.token}`}
                initial={{ opacity: 0, y: 4, scale: 0.94 }}
                animate={{ opacity: [0, 1, 1, 0], y: [4, -16, -26], scale: [0.94, 1.02, 1] }}
                exit={{ opacity: 0 }}
                transition={{ duration: forestRecoveryFeedback.symbiosisByTarget.PLAYER ? 1 : 0.72, ease: 'easeOut' }}
                className="absolute left-2 top-10 rounded-md border border-emerald-500/35 bg-black/78 px-2 py-1 font-mono text-[10px] font-black text-emerald-200 shadow-[0_0_18px_rgba(16,185,129,0.22)] pointer-events-none text-left"
              >
                <div>🌿 森林恢复</div>
                {forestRecoveryFeedback.recoveryByTarget.PLAYER ? (
                  <div>HP +{forestRecoveryFeedback.recoveryByTarget.PLAYER}</div>
                ) : null}
                {forestRecoveryFeedback.symbiosisByTarget.PLAYER && (
                  <div className="mt-1 text-[9px] leading-tight text-emerald-100/80">
                    <div>🌿 共生绽放</div>
                    <div>森林恢复：+2 HP</div>
                    <div>下一次感染提前 1 轮</div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="text-center">
          <div className="text-2xl font-black tracking-[4px] leading-tight">战术猜拳</div>
          <div className="text-[11px] text-accent font-bold tracking-widest">战斗引擎 V1.0</div>
          {screen === 'BATTLE' && gameMode === 'CHALLENGE' && (
            <div className="mt-1 text-[10px] font-mono font-black tracking-widest text-fuchsia-200/80">
              挑战模式 · 第 {currentChallengeStage} / {CHALLENGE_STAGE_CONFIG.totalStages} 关
            </div>
          )}
          {isBossPressureActive && bossPressureThreshold > 0 && (
            <div className="mt-0.5 text-[9px] font-mono font-black tracking-widest text-red-200/75">
              命运压迫：{bossPressure} / {bossPressureThreshold}
            </div>
          )}
        </div>

        <div className={`relative w-[300px] text-right p-1 rounded-lg transition-all duration-350 border border-transparent ${aiHPShake ? 'animate-hp-shake' : ''} ${burnFeedback?.targets.includes('AI') ? 'burn-hp-feedback animate-burn-hp-shake' : ''} ${forestRecoveryFeedback?.recoveryByTarget.AI ? 'forest-recovery-hp-feedback' : ''} ${aiHPFlash ? 'bg-red-500/10 border-red-500/35 shadow-[0_0_15px_rgba(239,68,68,0.15)] bg-opacity-30' : ''}`}>
          <div className="text-[12px] mb-1 text-text-dim tracking-wider">对手</div>
          <div className="w-full h-3 bg-[#222] rounded-full overflow-hidden border border-[#333]">
            <motion.div 
              initial={false}
              animate={{ width: `${(state.aiHP / currentAiMaxHP) * 100}%` }}
              className="h-full hp-bar-gradient-ai"
            />
          </div>
          <div className="flex justify-between mt-1 items-center font-mono opacity-80">
            <span className="text-sm">
              {state.aiHP}/{currentAiMaxHP}
              {forestRecoveryFeedback?.recoveryByTarget.AI ? (
                <span className="ml-2 text-[11px] font-black text-emerald-300 drop-shadow-[0_0_7px_rgba(52,211,153,0.55)]">+{forestRecoveryFeedback.recoveryByTarget.AI}</span>
              ) : null}
            </span>
            <span className="text-[10px]">生命</span>
          </div>
          {gameMode === 'CHALLENGE' && faithState.KITCHEN_GOD.level >= 1 && (
            <div className={`absolute right-0 -bottom-8 rounded-md border border-orange-400/28 bg-[#1a0d08]/88 px-2.5 py-1 text-right font-mono shadow-[0_0_14px_rgba(249,115,22,0.12)] transition-transform ${scorchFeedback?.type === 'mark' ? 'scale-110' : 'scale-100'}`}>
              <div className="text-[9px] font-black tracking-widest text-orange-200">🔥 灼痕</div>
              <div className="text-[10px] font-extrabold text-orange-100/80">
                {enemyScorchMarks} / {KITCHEN_GOD_CONFIG.scorchMarkLimit}
              </div>
              {faithState.KITCHEN_GOD.level >= 4 && (
                <div className="mt-1 border-t border-orange-300/15 pt-1 text-[8px] font-black tracking-widest text-orange-100/55">
                  <div>🔥 炉心爆燃</div>
                  <div className={hasTriggeredCoreCombustionThisEnemy ? 'text-orange-100/45' : 'text-amber-200/85'}>
                    {hasTriggeredCoreCombustionThisEnemy ? '本关已触发' : '就绪'}
                  </div>
                </div>
              )}
            </div>
          )}
          <AnimatePresence>
            {burnFeedback?.targets.includes('AI') && (
              <motion.div
                key={`ai-burn-${burnFeedback.token}`}
                initial={{ opacity: 0, y: 4, scale: 0.92 }}
                animate={{ opacity: [0, 1, 1, 0], y: [4, -18, -32], scale: [0.92, 1.04, 1] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.72, ease: 'easeOut' }}
                className="absolute right-2 -top-1 rounded-md border border-orange-500/35 bg-black/75 px-2 py-1 font-mono text-[11px] font-black text-orange-300 shadow-[0_0_18px_rgba(249,115,22,0.25)] pointer-events-none"
              >
                {VOLCANO_ENVIRONMENT_CONFIG.icon} 灼烧共鸣 -{VOLCANO_ENVIRONMENT_CONFIG.resonanceBonusDamage}
                <span className="absolute -left-3 top-2 text-[10px] opacity-80">{VOLCANO_ENVIRONMENT_CONFIG.icon}</span>
                <span className="absolute left-5 -top-2 text-[8px] opacity-60">{VOLCANO_ENVIRONMENT_CONFIG.icon}</span>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {scorchFeedback && (
              <motion.div
                key={`scorch-feedback-${scorchFeedback.token}`}
                initial={{ opacity: 0, y: 4, scale: 0.86 }}
                animate={{ opacity: [0, 1, 1, 0], y: [4, -8, -18, -28], scale: [0.86, 1.08, 1, 0.96] }}
                exit={{ opacity: 0 }}
                transition={{ duration: scorchFeedback.type === 'core' ? 1.15 : scorchFeedback.type === 'combustion' ? 0.95 : 0.72, ease: 'easeOut' }}
                className="absolute right-4 top-[58px] z-[92] rounded-lg border border-orange-400/40 bg-[#1a0904]/92 px-3 py-2 text-center font-mono text-orange-100 shadow-[0_0_28px_rgba(249,115,22,0.28)] pointer-events-none"
              >
                <div className="text-[12px] font-black tracking-widest">
                  🔥 {scorchFeedback.type === 'core' ? '炉心爆燃' : scorchFeedback.type === 'combustion' ? '爆燃' : scorchFeedback.type === 'fuel' ? '添薪' : scorchFeedback.type === 'ember' ? '余火未熄' : '灼痕 +1'}
                </div>
                {scorchFeedback.type === 'fuel' && (
                  <div className="mt-1 text-[10px] font-bold text-orange-100/75">灼痕额外 +1</div>
                )}
                {scorchFeedback.type === 'ember' && (
                  <div className="mt-1 text-[10px] font-bold text-orange-100/75">保留 1 层灼痕</div>
                )}
                {scorchFeedback.type === 'combustion' && (
                  <div className="mt-1 text-[10px] font-bold text-orange-100/75">额外伤害：{scorchFeedback.damage}</div>
                )}
                {scorchFeedback.type === 'core' && (
                  <div className="mt-1 space-y-0.5 text-[10px] font-bold text-orange-100/75">
                    <div>基础爆燃：{scorchFeedback.damage}</div>
                    <div className="text-amber-200/85">炉心追加：{scorchFeedback.coreDamage}</div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {forestRecoveryFeedback?.targets.includes('AI') && (
              <motion.div
                key={`ai-forest-recovery-${forestRecoveryFeedback.token}`}
                initial={{ opacity: 0, y: 4, scale: 0.94 }}
                animate={{ opacity: [0, 1, 1, 0], y: [4, -16, -26], scale: [0.94, 1.02, 1] }}
                exit={{ opacity: 0 }}
                transition={{ duration: forestRecoveryFeedback.symbiosisByTarget.AI ? 1 : 0.72, ease: 'easeOut' }}
                className="absolute right-2 top-10 rounded-md border border-emerald-500/35 bg-black/78 px-2 py-1 font-mono text-[10px] font-black text-emerald-200 shadow-[0_0_18px_rgba(16,185,129,0.22)] pointer-events-none text-right"
              >
                <div>🌿 森林恢复</div>
                {forestRecoveryFeedback.recoveryByTarget.AI ? (
                  <div>HP +{forestRecoveryFeedback.recoveryByTarget.AI}</div>
                ) : null}
                {forestRecoveryFeedback.symbiosisByTarget.AI && (
                  <div className="mt-1 text-[9px] leading-tight text-emerald-100/80">
                    <div>🌿 共生绽放</div>
                    <div>森林恢复：+2 HP</div>
                    <div>下一次感染提前 1 轮</div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="absolute left-4 top-24 z-[75] flex flex-col items-start gap-2 font-mono">
        {DEV_TOOLS_ENABLED && DEV_TOOLS_CONFIG.showPanel && gameMode === 'CHALLENGE' && (
          <>
            <button
              type="button"
              onClick={() => setIsDevPanelOpen(prev => !prev)}
              className="rounded-md border border-cyan-300/30 bg-black/70 px-3 py-1.5 text-[10px] font-black tracking-widest text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.12)] hover:border-cyan-200/55 hover:bg-cyan-950/55 active:scale-95"
            >
              🧪 Dev
            </button>
            {isDevPanelOpen && (
              <div className="w-[168px] rounded-lg border border-cyan-300/20 bg-[#061521]/94 p-2 shadow-[0_0_22px_rgba(34,211,238,0.14)]">
                <div className="mb-2 text-center text-[9px] font-black tracking-widest text-cyan-100/65">
                  CHALLENGE DEV
                </div>
                <div className="grid gap-1.5">
                  <button
                    type="button"
                    onClick={devDefeatCurrentAi}
                    disabled={Boolean(challengeStageClear) || state.winner !== null}
                    className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[9px] font-bold text-white/80 hover:border-cyan-200/35 hover:bg-cyan-950/30 disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    击败当前 AI
                  </button>
                  <button
                    type="button"
                    onClick={devFillPlayerHealth}
                    className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[9px] font-bold text-white/80 hover:border-cyan-200/35 hover:bg-cyan-950/30"
                  >
                    补满生命
                  </button>
                  <button
                    type="button"
                    onClick={devFillPlayerShield}
                    className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[9px] font-bold text-white/80 hover:border-cyan-200/35 hover:bg-cyan-950/30"
                  >
                    护盾充满
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDevDeityPickerOpen(true)}
                    className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[9px] font-bold text-white/80 hover:border-cyan-200/35 hover:bg-cyan-950/30"
                  >
                    三神满级
                  </button>
                  <button
                    type="button"
                    onClick={devClaimCurrentReward}
                    disabled={!challengeStageClear}
                    className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[9px] font-bold text-white/80 hover:border-cyan-200/35 hover:bg-cyan-950/30 disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    奖励测试
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => setIsExitLobbyDialogOpen(true)}
          className="rounded-md border border-white/10 bg-black/58 px-3 py-1.5 text-[10px] font-black tracking-widest text-text-main/80 shadow-[0_0_14px_rgba(0,0,0,0.18)] transition-all hover:border-accent/45 hover:text-accent hover:bg-black/72 active:scale-95"
        >
          退出大厅
        </button>
      </div>

      {/* Main Arena */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 relative">

        {/* AI Cards Back (Visual only) */}
        <div className="absolute top-5 right-10 flex gap-2 min-h-[56px] items-center">
          {state.aiHand.length === 0 ? (
            <div className="flex flex-col items-end justify-center font-mono opacity-80 text-right leading-tight border border-red-500/25 px-3 py-1.5 rounded-lg bg-red-950/20 shadow-[0_0_10px_rgba(239,68,68,0.15)] animate-[pulse_2s_infinite]">
              <span className="text-[10px] text-red-500 font-extrabold tracking-widest leading-none">{zhCN.notices.enemyNoCards}</span>
            </div>
          ) : (
            Array.from({ length: state.aiHand.length }).map((_, i) => (
              <div key={i} className="w-10 h-14 bg-[#1a1a20] border border-[#333] rounded-md opacity-40" 
                style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.05) 4px, rgba(255,255,255,0.05) 8px)' }}
              />
            ))
          )}
        </div>

        {/* AI DISCARD PILE (TOP-RIGHT AREA Adjacent to AI Hand) */}
        <div className="absolute top-4 right-[220px] flex items-center justify-end select-none font-mono">
          <AnimatePresence>
            {aiDiscardPrompt && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-[65px] right-0 bg-[#7f1d1d]/95 border border-red-500/30 rounded px-2.5 py-1.5 flex flex-col items-center select-none pointer-events-none font-mono text-red-400 font-bold leading-tight z-[25] min-w-[125px] text-center shadow-lg"
              >
                <span className="text-[9px] tracking-wider font-extrabold">{aiDiscardPrompt}</span>
                <span className="text-[8px] opacity-75 mt-0.5 font-bold">敌方弃牌区更新</span>
              </motion.div>
            )}
          </AnimatePresence>
          
          <div 
            onClick={() => {
              if (state.aiDiscardPile.length > 0) {
                setActiveDiscardModal('AI');
              }
            }}
            className={`flex items-center gap-2.5 transition-all duration-300 ${state.aiDiscardPile.length === 0 ? 'opacity-30 cursor-not-allowed' : 'opacity-100 cursor-pointer hover:scale-[1.05]'}`}
          >
            <div className="flex flex-col justify-center text-right">
              <span className="text-[9px] text-red-400/85 font-extrabold tracking-wider leading-none">{zhCN.resources.aiDiscard}</span>
              <span className="text-[8px] text-red-400/60 leading-none mt-1">{zhCN.resources.totalCards(state.aiDiscardPile.length)}</span>
            </div>
            
            {/* graphics stack: smaller than draw pile */}
            <div className="relative w-[42px] h-[56px] flex items-center justify-center">
              {/* Card 3 (Bottom) */}
              {state.aiDiscardPile.length > 2 && (
                <div className="absolute w-[38px] h-[52px] bg-zinc-900 border border-zinc-800 rounded -translate-x-1 translate-y-1 -rotate-6 opacity-30 shadow-sm" />
              )}
              {/* Card 2 (Middle) */}
              {state.aiDiscardPile.length > 1 && (
                <div className="absolute w-[40px] h-[54px] bg-zinc-800 border border-zinc-750 rounded -translate-x-0.5 translate-y-0.5 -rotate-3 opacity-60 shadow flex items-center justify-center" />
              )}
              {/* Card 1 (Top) */}
              <div className="absolute w-[42px] h-[56px] bg-[#1a1a22] border border-[#ef4444]/25 rounded flex items-center justify-center shadow-md">
                <div className="flex flex-col items-center justify-center font-mono text-[9px] text-[#ef4444]/80">
                  <span className="text-sm leading-none">▼</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {challengeStageClear ? (
            <motion.div
              key="challenge-stage-clear"
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="z-10 text-center font-mono"
            >
              <div className="text-[11px] font-black tracking-[0.24em] text-fuchsia-200/70 mb-2">挑战模式</div>
              <h2 className="text-4xl font-black tracking-widest text-accent mb-6">
                第 {challengeStageClear.completedStage} 关完成
              </h2>
              <div className="w-[420px] rounded-xl border border-fuchsia-400/25 bg-[#100b14]/92 px-6 py-5 text-left shadow-[0_0_28px_rgba(217,70,239,0.10)]">
                <div className="flex justify-between border-b border-white/[0.06] pb-2 mb-2">
                  <span className="text-text-dim">当前生命</span>
                  <span className="font-black text-white">{challengeStageClear.playerHP} / {playerMaxHp}</span>
                </div>
                <div className="flex justify-between border-b border-white/[0.06] pb-2 mb-2">
                  <span className="text-text-dim">护盾 / 手牌槽</span>
                  <span className="font-black text-white">{playerShield} / {CHALLENGE_REWARD_CONFIG.shieldLimit} · {playerHandLimit}</span>
                </div>
                <div className="flex justify-between border-b border-white/[0.06] pb-2 mb-2">
                  <span className="text-text-dim">保留手牌</span>
                  <span className="font-black text-white">{challengeStageClear.retainedHandCount} 张</span>
                </div>
                <div className="flex justify-between border-b border-white/[0.06] pb-2 mb-2">
                  <span className="text-text-dim">当前异变牌</span>
                  <span className="font-black text-white">{challengeStageClear.mutatedCardCount} 张</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-dim">下一关</span>
                  <span className="font-black text-fuchsia-200">第 {challengeStageClear.nextStage} 关</span>
                </div>
                {challengeStageClear.completedStage <= 2 && (
                  <div className="mt-4 border-t border-fuchsia-300/12 pt-4">
                    <div className="text-center text-[10px] font-black tracking-widest text-fuchsia-100/75">
                      选择一项神明赐福
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {DEITY_ORDER.map(deityType => {
                        const deity = DEITY_CONFIG[deityType];
                        const isClaimed = selectedStageReward?.stage === challengeStageClear.completedStage;
                        const isSelected = isClaimed && selectedStageReward?.deityType === deityType;
                        return (
                          <button
                            key={deity.id}
                            type="button"
                            onClick={() => claimStageFaithReward(deity.id)}
                            disabled={isClaimed}
                            className={`rounded-lg border px-2 py-2 text-center transition-all
                              ${isSelected
                                ? 'border-fuchsia-200/55 bg-fuchsia-950/45 text-fuchsia-50 shadow-[0_0_14px_rgba(217,70,239,0.16)]'
                                : 'border-white/10 bg-black/24 text-white/78 hover:border-fuchsia-200/35 hover:bg-fuchsia-950/25'
                              }
                              ${isClaimed && !isSelected ? 'opacity-35 cursor-not-allowed' : ''}
                            `}
                          >
                            <div className="text-xl leading-none">{deity.icon}</div>
                            <div className="mt-1 text-[11px] font-black tracking-wider">{deity.name}</div>
                            <div className="mt-1 text-[9px] font-bold text-fuchsia-100/70">信仰 +1</div>
                          </button>
                        );
                      })}
                    </div>
                    {selectedStageReward?.stage === challengeStageClear.completedStage && (
                      <div className="mt-3 rounded-md border border-fuchsia-300/18 bg-fuchsia-950/22 px-3 py-2 text-center text-[10px] font-bold tracking-wider text-fuchsia-100/80">
                        已获得：{DEITY_CONFIG[selectedStageReward.deityType].icon} {DEITY_CONFIG[selectedStageReward.deityType].name}信仰 +1
                      </div>
                    )}
                  </div>
                )}
                {isItemRewardStage(challengeStageClear.completedStage) && (
                  <div className="mt-4 border-t border-cyan-300/12 pt-4">
                    <div className="text-center text-[10px] font-black tracking-widest text-cyan-100/75">
                      选择一项战利品
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {STAGE_ITEM_REWARDS.map(reward => {
                        const isClaimed = selectedStageItemReward?.stage === challengeStageClear.completedStage;
                        const isSelected = isClaimed && selectedStageItemReward?.rewardId === reward.id;
                        const disabled = isClaimed || (reward.id === 'HAND_SLOT' && hasClaimedHandSlotReward);
                        const hint = reward.id === 'HAND_SLOT' && hasClaimedHandSlotReward
                          ? '本轮挑战已获得手牌扩容'
                          : reward.id === 'SHIELD_CHARGE' && playerShield >= CHALLENGE_REWARD_CONFIG.shieldLimit
                            ? '当前护盾已满'
                            : undefined;
                        return (
                          <button
                            key={reward.id}
                            type="button"
                            onClick={() => claimStageItemReward(reward.id)}
                            disabled={disabled}
                            title={hint}
                            className={`rounded-lg border px-2 py-2 text-center transition-all
                              ${isSelected
                                ? 'border-cyan-200/55 bg-cyan-950/45 text-cyan-50 shadow-[0_0_14px_rgba(34,211,238,0.16)]'
                                : 'border-white/10 bg-black/24 text-white/78 hover:border-cyan-200/35 hover:bg-cyan-950/25'
                              }
                              ${disabled && !isSelected ? 'opacity-35 cursor-not-allowed' : ''}
                            `}
                          >
                            <div className="text-xl leading-none">{reward.icon}</div>
                            <div className="mt-1 text-[11px] font-black tracking-wider">{reward.name}</div>
                            <div className="mt-1 min-h-[24px] text-[8px] font-bold leading-tight text-cyan-100/70">{reward.description}</div>
                            {hint && <div className="mt-1 text-[7px] font-bold text-cyan-100/45">{hint}</div>}
                          </button>
                        );
                      })}
                    </div>
                    {selectedStageItemReward?.stage === challengeStageClear.completedStage && (
                      <div className="mt-3 rounded-md border border-cyan-300/18 bg-cyan-950/22 px-3 py-2 text-center text-[10px] font-bold tracking-wider text-cyan-100/80">
                        已获得：{STAGE_ITEM_REWARDS.find(reward => reward.id === selectedStageItemReward.rewardId)?.icon} {STAGE_ITEM_REWARDS.find(reward => reward.id === selectedStageItemReward.rewardId)?.name}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={proceedToNextChallengeStage}
                aria-disabled={
                  (challengeStageClear.completedStage <= 2 && selectedStageReward?.stage !== challengeStageClear.completedStage)
                  || (isItemRewardStage(challengeStageClear.completedStage) && selectedStageItemReward?.stage !== challengeStageClear.completedStage)
                }
                className={`mt-6 w-[280px] py-3 px-8 rounded-lg font-bold uppercase tracking-widest transition-all
                  ${(challengeStageClear.completedStage <= 2 && selectedStageReward?.stage !== challengeStageClear.completedStage)
                    || (isItemRewardStage(challengeStageClear.completedStage) && selectedStageItemReward?.stage !== challengeStageClear.completedStage)
                    ? 'bg-zinc-800/45 text-text-dim/35 border border-zinc-700/40 cursor-pointer hover:border-fuchsia-300/20'
                    : 'bg-fuchsia-300 text-black hover:opacity-90 active:scale-[0.98] cursor-pointer'
                  }
                `}
              >
                进入下一关
              </button>
            </motion.div>
          ) : state.winner ? (
            <motion.div 
              key="gameover"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="z-10 text-center"
            >
              <h2 className={`text-6xl font-black uppercase tracking-tighter text-accent ${
                resourceDepletedWinnerDetail ? 'mb-4' : 'mb-8'
              }`}>
                {state.winner === 'PLAYER' ? zhCN.gameOver.win : state.winner === 'AI' ? zhCN.gameOver.lose : zhCN.gameOver.draw}
              </h2>
              {resourceDepletedWinnerDetail && (
                <div className="mb-8 font-mono flex flex-col items-center animate-[pulse_2s_infinite]">
                  <span className="text-red-400 text-xs font-semibold mt-1">
                    {resourceDepletedWinnerDetail.chn}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-4 items-center">
                <button 
                  onClick={() => resetGame()}
                  className="w-[280px] bg-accent text-black py-3 px-8 rounded-lg font-bold uppercase tracking-widest hover:opacity-80 transition-all flex flex-col items-center justify-center cursor-pointer"
                >
                  <span className="text-[13px] leading-tight tracking-[0.2em] font-black">{zhCN.gameOver.restartMission}</span>
                </button>
                <button 
                  onClick={returnToLobby}
                  className="w-[280px] bg-[#121316] text-[#a1a1aa] border border-[#27272a] py-3 px-8 rounded-lg font-bold uppercase tracking-widest hover:border-[#52525b] hover:text-[#f4f4f5] transition-all flex flex-col items-center justify-center cursor-pointer"
                >
                  <span className="text-[12px] leading-tight tracking-[0.15em] font-black">{zhCN.gameOver.returnToLobby}</span>
                </button>
              </div>
            </motion.div>
          ) : (
            <div key="battle" className="flex flex-col gap-3 items-center relative">
              <div className={`route-event-panel route-event-panel--${activeEnvironmentType.toLowerCase()} fixed top-[104px] left-[max(18px,calc((100vw-1500px)/2+24px))] z-[18] w-[260px] rounded-md border px-2.5 py-1.5 text-center font-mono ${mutationEventPulse ? 'route-event-panel--pulse' : ''}`}>
                <div className="relative z-10 text-[8px] font-black tracking-[0.22em] text-white/42">{currentModeConfig.name}</div>
                {currentModeConfig.environmentMode === 'SINGLE' ? (
                  <div className="relative z-10 mt-1 flex flex-col items-center justify-center">
                    <div className="text-[13px] font-black tracking-widest text-white/90">
                      <span aria-hidden="true">{activeEnvironmentConfig.icon}</span> {environmentLabel(activeEnvironmentType)}环境
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="relative z-10 mt-0.5 text-[8px] font-black tracking-[0.22em] text-white/35">环境路线</div>
                    <div className="relative z-10 mt-1 flex items-center justify-center gap-1.5">
                      <div className="min-w-[82px] text-right">
                        <div className="text-[12px] font-black tracking-widest text-white/90">
                          <span aria-hidden="true">{activeEnvironmentConfig.icon}</span> {environmentLabel(activeEnvironmentType)}
                        </div>
                        <div className="mt-0.5 text-[8px] font-bold text-white/52">当前环境 · 剩余 {environmentRoundsRemaining} 轮</div>
                      </div>
                      <div className="text-[13px] font-black text-white/35">→</div>
                      <div className="min-w-[70px] text-left">
                        <div className="text-[10px] font-black tracking-widest text-white/62">
                          <span aria-hidden="true">{nextEnvironmentConfig.icon}</span> {environmentLabel(nextEnvironmentType)}
                        </div>
                        <div className="mt-0.5 text-[8px] font-bold text-white/38">下一环境</div>
                      </div>
                      <div className="text-[13px] font-black text-white/26">→</div>
                      <div className="min-w-[70px] text-left">
                        <div className="text-[10px] font-black tracking-widest text-white/50">
                          <span aria-hidden="true">{upcomingEnvironmentConfig.icon}</span> {environmentLabel(upcomingEnvironmentType)}
                        </div>
                        <div className="mt-0.5 text-[8px] font-bold text-white/30">后续环境</div>
                      </div>
                    </div>
                  </>
                )}
                <div className="relative z-10 mt-1 text-[9px] font-semibold text-white/70">
                  {mutationEventStatus.startsWith('下一次感染：') ? (
                    <>
                      下一次{activeMutationLabel}感染：
                      <span className="mx-0.5 text-[12px] font-black text-white drop-shadow-[0_0_7px_rgba(255,255,255,0.28)]">
                        {mutationRoundsRemaining}
                      </span>
                      轮后
                    </>
                  ) : mutationEventStatus}
                </div>
              </div>

              {/* AI Battle Slot */}
              <div className="flex gap-4 min-h-[140px] items-center">
                <div className={`absolute -right-32 top-8 min-w-[120px] text-[10px] font-mono font-bold text-white/70 tracking-wider transition-transform duration-200 ${aiMutationCountPulse ? 'scale-110' : 'scale-100'}`}>
                  <div>对手异变牌：{aiMutationCount} / {mutationLimit}</div>
                  {aiMutationCount >= mutationLimit && (
                    <div className="mt-0.5 text-[9px] text-emerald-200/45">已达上限</div>
                  )}
                </div>
                {(state.aiRole === 'HOME' ? state.homePlayed : state.guestPlayed).length > 0 ? (
                  (state.aiRole === 'HOME' ? state.homePlayed : state.guestPlayed).map(c => (
                    <BattleCard 
                      key={c.id} 
                      card={c} 
                      faceDown={state.aiRole === 'HOME' && state.phase !== 'REVEAL' && state.phase !== 'RESOLVE' && state.phase !== 'GAME_OVER'} 
                    />
                  ))
                ) : (
                  state.aiRole === 'GUEST' && (state.phase === 'REVEAL' || state.phase === 'RESOLVE' || state.phase === 'GAME_OVER') ? (
                    <motion.div 
                      key="ai_pass"
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="w-[90px] h-[120px] rounded-xl border border-red-500/30 bg-red-950/10 flex flex-col items-center justify-center font-mono select-none"
                    >
                      <div className="text-2xl mb-1 text-red-400">🛡️❌</div>
                      <span className="text-[10px] font-black tracking-wider text-red-400 leading-none">对手放弃防守</span>
                    </motion.div>
                  ) : (
                    <div className="w-[90px] h-[120px] rounded-xl border-2 border-dashed border-border flex items-center justify-center text-text-dim opacity-30 text-2xl">?</div>
                  )
                )}
              </div>

              {/* Tactical Phase Indicator Bar & Clash Settlement Overlay */}
              <div className="h-[40px] flex items-center justify-center relative w-[450px] my-2 select-none">
                <AnimatePresence mode="wait">
                  {clashResult ? (
                    <motion.div
                      key="clash-overlay"
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -2 }}
                      transition={{ duration: 0.2 }}
                      className={`absolute z-[80] w-[450px] rounded-xl bg-[#080a0f]/98 border backdrop-blur-md p-4 font-mono flex flex-col items-center justify-center gap-2.5 shadow-[0_0_40px_rgba(0,0,0,0.85)]
                        ${(() => {
                          const pDmg = clashResult.playerHPChange;
                          const aiDmg = clashResult.aiHPChange;
                          if (pDmg === 0 && aiDmg === 0) {
                            return 'border-zinc-500/35 shadow-[0_0_20px_rgba(113,113,122,0.1)] text-zinc-300';
                          } else if (pDmg > 0 && aiDmg > 0) {
                            return 'border-amber-500/40 shadow-[0_0_25px_rgba(245,158,11,0.12)] text-amber-200';
                          } else if (aiDmg > 0) {
                            return 'border-emerald-500/45 shadow-[0_0_25px_rgba(16,185,129,0.12)] text-emerald-100';
                          } else {
                            return 'border-red-500/45 shadow-[0_0_25px_rgba(239,68,68,0.12)] text-red-100';
                          }
                        })()}
                      `}
                    >
                      {/* Badge / Subtitle */}
                      <div className="flex items-center gap-2">
                        <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${(() => {
                          const pDmg = clashResult.playerHPChange;
                          const aiDmg = clashResult.aiHPChange;
                          if (pDmg === 0 && aiDmg === 0) return 'bg-zinc-500';
                          if (pDmg > 0 && aiDmg > 0) return 'bg-amber-500';
                          if (aiDmg > 0) return 'bg-emerald-500 animate-pulse';
                          return 'bg-red-500 animate-pulse';
                        })()}`} />
                        <span className="text-[9px] font-black uppercase tracking-widest text-[#9ea0a5]/80">
                          {(() => {
                            const isPlayerHome = clashResult.playerRole === 'HOME';
                            const pDmg = clashResult.playerHPChange;
                            const aiDmg = clashResult.aiHPChange;
                            if (pDmg === 0 && aiDmg === 0) return '攻防抵消';
                            if (pDmg > 0 && aiDmg > 0) return '双方受击';
                            if (aiDmg > 0) {
                              return isPlayerHome ? '突破成功' : '反制成功';
                            }
                            return isPlayerHome ? '防守被突破' : '战线破裂';
                          })()}
                        </span>
                      </div>

                      {/* Main result status */}
                      <div className="text-[12px] font-black uppercase tracking-widest">
                        {(() => {
                          const pDmg = clashResult.playerHPChange;
                          const aiDmg = clashResult.aiHPChange;
                          if (pDmg === 0 && aiDmg === 0) return '对冲抵消';
                          if (pDmg > 0 && aiDmg > 0) return '双向受击';
                          if (aiDmg > 0) {
                            return clashResult.noDefense ? '对方未出牌' : '克制成功';
                          }
                          return clashResult.noDefense ? '防守空过' : '防守失败';
                        })()}
                      </div>

                      {/* Attribute Match expressions list */}
                      <div className="w-[85%] flex flex-col gap-1 items-center justify-center border-y border-white/[0.04] py-1.5 px-3">
                        {clashResult.matches.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2.5 text-[10.5px] justify-center">
                            <span className="opacity-50 text-[9px] leading-none">
                              {clashResult.playerRole === 'HOME' ? '玩家' : '对手'}
                            </span>
                            <span className="font-extrabold text-white text-[11px]">
                              {item.homeMutationType === 'VOLCANO' && item.winner === 'HOME' ? '🔥 ' : ''}
                              {item.homeMutationType === 'FOREST' ? '🌿 ' : ''}
                              {item.homeMutationType === 'GLACIER' ? '❄️ ' : ''}
                              {item.homeType
                                ? (item.homeMutationType === 'VOLCANO'
                                  ? volcanoCardLabel(item.homeType)
                                  : item.homeMutationType === 'FOREST'
                                    ? forestCardLabel(item.homeType)
                                    : item.homeMutationType === 'GLACIER'
                                      ? glacierCardLabel(item.homeType)
                                      : cardLabel(item.homeType))
                                : ''}
                            </span>
                            <span className={`text-[12px] font-extrabold ${item.winner === 'HOME' ? 'text-amber-400' : item.winner === 'GUEST' ? 'text-sky-400' : 'text-zinc-500'}`}>
                              {item.winner === 'HOME' ? '▶' : item.winner === 'GUEST' ? '◀' : '＝'}
                            </span>
                            <span className="font-extrabold text-white text-[11px]">
                              {item.guestMutationType === 'VOLCANO' && item.winner === 'GUEST' ? '🔥 ' : ''}
                              {item.guestMutationType === 'FOREST' ? '🌿 ' : ''}
                              {item.guestMutationType === 'GLACIER' ? '❄️ ' : ''}
                              {item.guestType
                                ? (item.guestMutationType === 'VOLCANO'
                                  ? volcanoCardLabel(item.guestType)
                                  : item.guestMutationType === 'FOREST'
                                    ? forestCardLabel(item.guestType)
                                    : item.guestMutationType === 'GLACIER'
                                      ? glacierCardLabel(item.guestType)
                                      : cardLabel(item.guestType))
                                : ''}
                            </span>
                            <span className="opacity-50 text-[9px] leading-none">
                              {clashResult.playerRole === 'HOME' ? '对手' : '玩家'}
                            </span>
                          </div>
                        ))}
                        {clashResult.matches.length === 0 && (
                          <div className="text-[10px] text-zinc-400 opacity-80 uppercase tracking-widest font-bold">
                            对方未出牌
                          </div>
                        )}
                      </div>

                      {/* Dynamic Damage outcomes */}
                      <div className="text-center">
                        <div className="text-[13px] font-black tracking-wide">
                          {(() => {
                            const pDmg = clashResult.playerHPChange;
                            const aiDmg = clashResult.aiHPChange;
                            if (pDmg === 0 && aiDmg === 0) return <span className="text-zinc-400 font-bold tracking-widest">未造成伤害</span>;
                            return (
                              <div className="flex gap-4 items-center justify-center">
                                {aiDmg > 0 && (
                                  <span className="text-emerald-400 font-extrabold flex items-center gap-1">敌方生命 -{aiDmg}</span>
                                )}
                                {pDmg > 0 && (
                                  <span className="text-red-400 font-extrabold flex items-center gap-1">我方生命 -{pDmg}</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        {(clashResult.aiHPChange > 0 || clashResult.playerHPChange > 0) && (
                          <div className="mt-2 flex flex-col gap-1 text-[9.5px] font-mono">
                            {clashResult.aiHPChange > 0 && (
                              <div className="rounded border border-orange-500/20 bg-orange-950/10 px-2 py-1 text-orange-100/85">
                                <span className="font-black">对手承伤</span>
                                <span className="mx-1 text-orange-200/40">|</span>
                                卡牌基础伤害：{clashResult.aiBaseDamage}
                                {clashResult.aiVolcanoDamage > 0 && (
                                  <span className="text-orange-300">　火山异变：+{clashResult.aiVolcanoDamage}</span>
                                )}
                                {clashResult.aiResonanceDamage > 0 && (
                                  <span className="text-red-300">　灼烧伤害：+{clashResult.aiResonanceDamage}</span>
                                )}
                                <span className="text-white/80">　最终伤害：{clashResult.aiHPChange}</span>
                              </div>
                            )}
                            {clashResult.playerHPChange > 0 && (
                              <div className="rounded border border-orange-500/20 bg-orange-950/10 px-2 py-1 text-orange-100/85">
                                <span className="font-black">我方承伤</span>
                                <span className="mx-1 text-orange-200/40">|</span>
                                卡牌基础伤害：{clashResult.playerBaseDamage}
                                {clashResult.playerVolcanoDamage > 0 && (
                                  <span className="text-orange-300">　火山异变：+{clashResult.playerVolcanoDamage}</span>
                                )}
                                {clashResult.playerResonanceDamage > 0 && (
                                  <span className="text-red-300">　灼烧伤害：+{clashResult.playerResonanceDamage}</span>
                                )}
                                <span className="text-white/80">　最终伤害：{clashResult.playerHPChange}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {(clashResult.playerForestRecovery > 0 || clashResult.aiForestRecovery > 0 || clashResult.playerSymbiosisTriggered || clashResult.aiSymbiosisTriggered) && (
                          <div className="mt-2 flex flex-col gap-1 text-[9.5px] font-mono">
                            {clashResult.playerForestRecovery > 0 && (
                              <div className="rounded border border-emerald-500/20 bg-emerald-950/10 px-2 py-1 text-emerald-100/85">
                                <span className="font-black">我方森林恢复</span>
                                <span className="mx-1 text-emerald-200/40">|</span>
                                HP +{clashResult.playerForestRecovery}
                              </div>
                            )}
                            {clashResult.aiForestRecovery > 0 && (
                              <div className="rounded border border-emerald-500/20 bg-emerald-950/10 px-2 py-1 text-emerald-100/85">
                                <span className="font-black">对手森林恢复</span>
                                <span className="mx-1 text-emerald-200/40">|</span>
                                HP +{clashResult.aiForestRecovery}
                              </div>
                            )}
                            {(clashResult.playerSymbiosisTriggered || clashResult.aiSymbiosisTriggered) && (
                              <div className="rounded border border-emerald-400/25 bg-emerald-900/12 px-2 py-1 text-emerald-200/90">
                                🌿 共生绽放　森林恢复：+2 HP　下一次感染提前 1 轮
                              </div>
                            )}
                          </div>
                        )}

                      </div>
                    </motion.div>
                  ) : (() => {
                    const { titleEng, titleChn, type, pulse, bounce } = getPhaseIndicator();
                    
                    let glowClass = "shadow-[0_0_15px_rgba(255,255,255,0.02)]";
                    let borderClass = "border-white/[0.08]";
                    let accentTextClass = "text-text-dim";
                    let lightBgClass = "bg-white/20";

                    if (type === 'green') {
                      glowClass = "shadow-[0_0_12px_rgba(16,185,129,0.12)]";
                      borderClass = "border-emerald-500/30";
                      accentTextClass = "text-emerald-400";
                      lightBgClass = "bg-emerald-500";
                    } else if (type === 'amber') {
                      glowClass = "shadow-[0_0_15px_rgba(245,158,11,0.15)]";
                      borderClass = "border-amber-500/30";
                      accentTextClass = "text-amber-400";
                      lightBgClass = "bg-amber-500";
                    } else if (type === 'blue') {
                      glowClass = "shadow-[0_0_15px_rgba(59,130,246,0.15)]";
                      borderClass = "border-blue-500/30";
                      accentTextClass = "text-blue-400";
                      lightBgClass = "bg-blue-500";
                    } else if (type === 'red') {
                      glowClass = "shadow-[0_0_15px_rgba(239,68,68,0.25)]";
                      borderClass = "border-red-500/40";
                      accentTextClass = "text-red-400 font-extrabold";
                      lightBgClass = "bg-red-500";
                    }

                    return (
                      <motion.div
                        key={titleEng}
                        initial={{ opacity: 0, y: -2 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`w-[450px] min-h-[34px] py-1.5 px-4 rounded-lg bg-[#0e0f14]/90 border ${borderClass} ${glowClass} backdrop-blur-md flex items-center justify-center font-mono select-none relative overflow-hidden ${pulse ? 'animate-pulse' : ''}`}
                      >
                        <div className="flex items-center justify-center gap-2 min-w-0">
                          <div className="relative flex h-2 w-2">
                            {pulse && (
                              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${lightBgClass} opacity-75`}></span>
                            )}
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${lightBgClass}`}></span>
                          </div>
                          <span className={`text-[11px] font-black tracking-wider truncate ${accentTextClass}`}>
                            {titleChn}
                          </span>
                          {bounce && (
                            <span className="inline-flex gap-0.5 ml-1">
                              <span className="animate-[bounce_0.6s_infinite_100ms] inline-block h-1 w-1 bg-amber-400 rounded-full"></span>
                              <span className="animate-[bounce_0.6s_infinite_200ms] inline-block h-1 w-1 bg-amber-400 rounded-full"></span>
                              <span className="animate-[bounce_0.6s_infinite_300ms] inline-block h-1 w-1 bg-amber-400 rounded-full"></span>
                            </span>
                          )}
                        </div>
                      </motion.div>
                    );
                  })()}
                </AnimatePresence>
              </div>

              {/* Defense Limit Brief Notice */}
              <AnimatePresence>
                {defenseLimitNotice !== null && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-[204px] z-[90] w-[320px] py-1.5 px-2 bg-[#100607]/95 border border-red-500/40 text-center rounded-lg shadow-[0_0_15px_rgba(239,68,68,0.18)] pointer-events-none font-mono"
                  >
                    <div className="text-[10px] font-black text-red-400 tracking-wider">{zhCN.notices.defenseLimitReached}</div>
                    <div className="text-[10.5px] text-red-200 mt-0.5">{zhCN.notices.maxDefenseCards(defenseLimitNotice)}</div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Player Battle Slot */}
              <div className="flex gap-4 min-h-[140px] items-center">
                {(state.playerRole === 'HOME' ? state.homePlayed : state.guestPlayed).length > 0 ? (
                  (state.playerRole === 'HOME' ? state.homePlayed : state.guestPlayed).map(c => <BattleCard key={c.id} card={c} />)
                ) : (
                  <div className="w-[90px] h-[120px] rounded-xl border-2 border-dashed border-border flex items-center justify-center text-text-dim opacity-30"></div>
                )}
              </div>
            </div>
          )}
        </AnimatePresence>

        {/* Game Log */}
        <button
          type="button"
          onClick={() => setIsBattleLogOpen(true)}
          className="fixed left-[max(18px,calc((100vw-1500px)/2+24px))] bottom-[214px] z-[36] h-[52px] w-[52px] rounded-lg border border-border/80 bg-[#0a0a0b]/86 text-text-main shadow-[0_0_18px_rgba(0,0,0,0.28)] backdrop-blur-md transition-all hover:border-accent/45 hover:text-accent active:scale-95 flex flex-col items-center justify-center font-mono"
          aria-label="打开战斗日志"
        >
          <span className="text-[18px] leading-none">☰</span>
          <span className="mt-1 text-[10px] font-black tracking-widest leading-none">日志</span>
          {!isBattleLogOpen && logs.length > 0 && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(245,158,11,0.7)]" />
          )}
        </button>

        <AnimatePresence>
          {isBattleLogOpen && (
            <>
              <motion.button
                type="button"
                aria-label="关闭战斗日志"
                className="fixed inset-0 z-[64] cursor-default bg-black/5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                onClick={() => setIsBattleLogOpen(false)}
              />
              <motion.aside
                ref={logContainerRef}
                className="fixed left-0 top-[190px] bottom-[205px] z-[65] w-[clamp(300px,28vw,420px)] max-h-[calc(100vh-120px)] bg-[#0a0a0b]/88 backdrop-blur-md rounded-r-xl p-3.5 text-[12px] overflow-y-auto border-y border-r border-border custom-scrollbar flex flex-col gap-1.5 scroll-smooth shadow-[18px_0_42px_rgba(0,0,0,0.34)]"
                initial={{ x: '-102%', opacity: 0.88 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '-102%', opacity: 0.88 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                onClick={event => event.stopPropagation()}
              >
                <div className="font-bold text-accent text-[10px] tracking-widest sticky top-0 bg-[#0a0a0b]/60 backdrop-blur-[3px] pb-2 border-b border-border/40 z-10 flex items-center justify-between">
                  <span>战斗日志</span>
                  <button
                    type="button"
                    onClick={() => setIsBattleLogOpen(false)}
                    className="h-6 w-6 rounded-md border border-white/10 bg-white/5 text-[14px] leading-none text-text-dim transition-colors hover:text-white hover:border-white/25"
                    aria-label="关闭战斗日志"
                  >
                    ×
                  </button>
                </div>
                <div className="flex flex-col gap-1.5 pt-1 font-mono">
            {logs.map((log, index) => {
              const isPlayer = log.includes('[玩家]') || log.includes('[我方]');
              const isAI = log.includes('[对手]') || log.includes('[敌方]');
              const isSettlement = log.includes('[结算]') || log.includes('[伤害]');
              const isInvalid = log.includes('无效');
              const isSystem = log.includes('[系统]') || log.includes('[公共牌库]');
              
              const isEnvironment = log.includes('[环境事件]');
              const isPlayerMutation = log.includes('[玩家]') && log.includes('火山');
              const isForestMutation = (log.includes('[玩家]') && log.includes('森林')) || (isEnvironment && log.includes('森林感染'));
              const isForestGrowthLog = log.includes('[森林成长]');
              const isForestRecoveryLog = log.includes('[森林恢复]') || (log.includes('[恢复]') && log.includes('森林'));
              const isHpRecoveryLog = log.includes('[恢复]') && log.includes('HP');
              const isSymbiosisLog = log.includes('[羁绊]') && log.includes('共生绽放');
              const isGlacierInfectionLog = (isEnvironment && log.includes('冰川感染')) || (log.includes('[玩家]') && log.includes('冰川'));
              const isGlacierRecycleLog = log.includes('[冰川回收]');
              const isGlacierEchoLog = log.includes('极寒回响');
              const isGlacierNormalReturnLog = isGlacierRecycleLog && (log.includes('恢复为普通牌') || log.includes('已使用过') || log.includes('返回手牌并恢复'));
              const isAiMutation = isEnvironment && log.includes('对手获得');
              const isMutationLimit = isEnvironment && log.includes('上限');
              const isMutationClosed = isEnvironment && log.includes('耗尽');
              const isVolcanoDamage = log.includes('[火山异变]');
              const isEnvironmentRouteLog = log.includes('[环境路线]');
              const isEnvironmentSwitchLog = log.includes('[环境切换]');
              const isBondLog = log.includes('[羁绊]');
              const isBurnLog = log.includes('[灼烧]');
              
              let textColor = 'text-text-dim';
              if (isEnvironmentSwitchLog) textColor = 'text-white/90 font-semibold';
              else if (isEnvironmentRouteLog) textColor = 'text-sky-200/80';
              else if (isSymbiosisLog) textColor = 'text-teal-300 font-semibold';
              else if (isForestRecoveryLog) textColor = 'text-emerald-300 font-semibold';
              else if (isHpRecoveryLog) textColor = 'text-emerald-200/90';
              else if (isForestGrowthLog) textColor = 'text-emerald-400/90';
              else if (isForestMutation) textColor = 'text-lime-300/85';
              else if (isGlacierEchoLog) textColor = 'text-sky-100 font-semibold';
              else if (isGlacierNormalReturnLog) textColor = 'text-slate-300/80';
              else if (isGlacierRecycleLog) textColor = 'text-cyan-200/90';
              else if (isGlacierInfectionLog) textColor = 'text-sky-200/85';
              else if (isBondLog) textColor = 'text-orange-300';
              else if (isBurnLog) textColor = 'text-orange-500/90';
              else if (isVolcanoDamage) textColor = 'text-orange-500/90';
              else if (isMutationClosed) textColor = 'text-zinc-500';
              else if (isMutationLimit) textColor = 'text-orange-300/55';
              else if (isAiMutation) textColor = 'text-red-400/75';
              else if (isPlayerMutation) textColor = 'text-orange-200/90';
              else if (isEnvironment) textColor = 'text-orange-400/85';
              else if (isSystem) textColor = 'text-[#10b981]/80'; // Emerald / green
              else if (isInvalid) textColor = 'text-[#f59e0b]/80'; // Orange / amber
              else if (isPlayer) textColor = 'text-[#3b82f6]'; // Blue
              else if (isAI) textColor = 'text-[#ef4444]'; // Red
              else if (isSettlement) textColor = 'text-accent'; // Golden amber

              return (
                <div key={index} className={`leading-relaxed text-[11px] pb-1 border-b border-white/[0.02] last:border-b-0 ${textColor}`}>
                  <span className="text-[9px] text-white/20 mr-1 font-sans">[{index + 1}]</span>
                  {log}
                </div>
              );
            })}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isDevDeityPickerOpen && DEV_TOOLS_ENABLED && DEV_TOOLS_CONFIG.showPanel && gameMode === 'CHALLENGE' && (
            <>
              <motion.button
                type="button"
                aria-label="关闭神明满级选择"
                className="fixed inset-0 z-[116] cursor-default bg-black/45 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                onClick={() => setIsDevDeityPickerOpen(false)}
              />
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="dev-deity-picker-title"
                className="fixed left-1/2 top-1/2 z-[117] w-[330px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-cyan-300/20 bg-[#061521]/96 p-4 font-mono text-text-main shadow-[0_0_34px_rgba(34,211,238,0.18)]"
                initial={{ opacity: 0, scale: 0.94, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                onClick={event => event.stopPropagation()}
              >
                <div id="dev-deity-picker-title" className="text-center text-[14px] font-black tracking-widest text-cyan-100">
                  选择神明满级
                </div>
                <div className="mt-4 grid gap-2">
                  <button
                    type="button"
                    onClick={() => devMaxSingleDeity('KITCHEN_GOD', '灶神')}
                    className="h-9 rounded-lg border border-white/10 bg-black/30 text-[10px] font-black tracking-widest text-white/85 transition-all hover:border-cyan-200/40 hover:bg-cyan-950/35 active:scale-[0.98]"
                  >
                    灶神满级
                  </button>
                  <button
                    type="button"
                    onClick={() => devMaxSingleDeity('DEER_SPIRIT', '鹿灵')}
                    className="h-9 rounded-lg border border-white/10 bg-black/30 text-[10px] font-black tracking-widest text-white/85 transition-all hover:border-cyan-200/40 hover:bg-cyan-950/35 active:scale-[0.98]"
                  >
                    鹿灵满级
                  </button>
                  <button
                    type="button"
                    onClick={() => devMaxSingleDeity('FROST_LORD', '霜君')}
                    className="h-9 rounded-lg border border-white/10 bg-black/30 text-[10px] font-black tracking-widest text-white/85 transition-all hover:border-cyan-200/40 hover:bg-cyan-950/35 active:scale-[0.98]"
                  >
                    霜君满级
                  </button>
                  <button
                    type="button"
                    onClick={devMaxAllDeities}
                    className="h-9 rounded-lg border border-cyan-300/26 bg-cyan-950/28 text-[10px] font-black tracking-widest text-cyan-100 transition-all hover:border-cyan-200/55 hover:bg-cyan-900/35 active:scale-[0.98]"
                  >
                    三神全部满级
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDevDeityPickerOpen(false)}
                    className="h-8 rounded-lg border border-white/10 bg-white/[0.04] text-[10px] font-black tracking-widest text-text-dim transition-all hover:border-white/24 hover:text-white active:scale-[0.98]"
                  >
                    取消
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isExitLobbyDialogOpen && (
            <>
              <motion.button
                type="button"
                aria-label="关闭退出大厅确认"
                className="fixed inset-0 z-[118] cursor-default bg-black/55 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                onClick={() => setIsExitLobbyDialogOpen(false)}
              />
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="exit-lobby-title"
                className="fixed left-1/2 top-1/2 z-[119] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/12 bg-[#0b0b10]/96 p-5 font-mono text-text-main shadow-[0_0_38px_rgba(0,0,0,0.42)]"
                initial={{ opacity: 0, scale: 0.94, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                onClick={event => event.stopPropagation()}
              >
                <div id="exit-lobby-title" className="text-center text-[15px] font-black tracking-widest text-accent">
                  退出大厅
                </div>
                <div className="mt-3 text-center text-[12px] font-bold leading-relaxed text-text-dim/80">
                  是否保留当前进度后返回大厅？
                </div>
                <div className="mt-5 grid gap-2">
                  <button
                    type="button"
                    onClick={() => exitBattleToLobby(true)}
                    className="h-10 rounded-lg border border-emerald-300/28 bg-emerald-950/28 text-[11px] font-black tracking-widest text-emerald-100 transition-all hover:border-emerald-200/55 hover:bg-emerald-900/35 active:scale-[0.98]"
                  >
                    保留存档退出
                  </button>
                  <button
                    type="button"
                    onClick={() => exitBattleToLobby(false)}
                    className="h-10 rounded-lg border border-red-300/24 bg-red-950/24 text-[11px] font-black tracking-widest text-red-100 transition-all hover:border-red-200/45 hover:bg-red-900/30 active:scale-[0.98]"
                  >
                    不保留存档退出
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsExitLobbyDialogOpen(false)}
                    className="h-9 rounded-lg border border-white/10 bg-white/[0.04] text-[10px] font-black tracking-widest text-text-dim transition-all hover:border-white/24 hover:text-white active:scale-[0.98]"
                  >
                    取消
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Footer / Hand */}
      <div className="h-[190px] bg-surface border-t border-border px-8 py-3 flex items-center justify-center z-20 relative select-none">
        
        {/* LEFT COLUMN: SHARED DRAW PILE */}
        <div className="fixed bottom-[28px] right-[max(116px,calc((100vw-1500px)/2+116px))] z-[24] w-[86px] flex flex-col items-center justify-center select-none">
          {/* AnimatePresence for Shared Deck temporary floating prompts */}
          <AnimatePresence>
            {sharedDeckPrompt && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className={`absolute bottom-[110px] flex flex-col items-center text-center font-mono font-bold leading-tight select-none pointer-events-none rounded-lg px-2.5 py-1.5 border min-w-[130px] shadow-lg z-[30] ${
                  sharedDeckPrompt.startsWith('我方') || sharedDeckPrompt.startsWith('玩家')
                    ? 'bg-[#064e3b]/95 border-emerald-500/40 text-emerald-400' 
                    : 'bg-[#7f1d1d]/95 border-red-500/40 text-red-100 text-red-400'
                }`}
              >
                <span className="text-[9px] tracking-widest font-black uppercase text-center">{sharedDeckPrompt}</span>
                <span className="text-[8px] opacity-75 mt-0.5 font-bold">{sharedDeckSubPrompt}</span>
                {sharedDeckTransit && (
                  <span className="text-[8px] font-mono mt-1 px-1.5 py-0.5 bg-black/40 rounded border border-white/5 font-extrabold text-zinc-300">
                    {sharedDeckTransit}
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-center relative">
            <AnimatePresence>
              {sharedDeckChangeAmount && (
                <motion.div
                  initial={{ scale: 0.5, opacity: 0, y: 0 }}
                  animate={{ scale: 1.25, opacity: 1, y: -18 }}
                  exit={{ opacity: 0 }}
                  className={`absolute -left-8 top-2 font-mono font-black text-sm z-[20] ${
                    sharedDeckPrompt?.startsWith('我方') || sharedDeckPrompt?.startsWith('玩家') ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {sharedDeckChangeAmount}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Deck stack view */}
            <div className={`relative w-[42px] h-[58px] flex items-center justify-center transition-transform duration-250 ${
              sharedDeckScale ? 'scale-[1.08]' : ''
            }`}>
              {/* Card 3 (Bottom) */}
              {state.drawPile.length > 2 && (
                <div className="absolute w-[36px] h-[52px] bg-zinc-850 border border-zinc-750/30 rounded-md translate-x-1 translate-y-1 rotate-6 opacity-30 shadow-sm" />
              )}
              {/* Card 2 (Middle) */}
              {state.drawPile.length > 1 && (
                <div className="absolute w-[38px] h-[54px] bg-zinc-800 border border-zinc-700 rounded-md translate-x-0.5 translate-y-0.5 rotate-3 opacity-60 shadow flex items-center justify-center" />
              )}
              {/* Card 1 (Top) */}
              <div className={`absolute w-[40px] h-[56px] bg-[#1a1c23] border rounded-md flex items-center justify-center shadow-md transition-all ${
                state.drawPile.length === 0
                  ? 'border-red-500/75 bg-red-950/25 animate-[pulse_1.4s_infinite]'
                  : 'border-slate-500/35'
              }`}>
                <div className="relative w-full h-full flex items-center justify-center">
                  <ArrowUpDown className={`w-4 h-4 ${state.drawPile.length === 0 ? 'text-red-400' : 'text-slate-300/70'}`} />
                </div>
              </div>
            </div>
          </div>
          
          <div className={`text-[9px] font-extrabold font-mono tracking-widest mt-2 text-center leading-tight ${
            state.drawPile.length === 0 ? 'text-red-400 animate-[pulse_1.4s_infinite]' : 'text-slate-300/85'
          }`}>
            {state.drawPile.length === 0 ? zhCN.resources.depleted : zhCN.resources.sharedDeck}
            <span className={`block text-[8px] font-semibold mt-0.5 ${
              state.drawPile.length === 0 ? 'text-red-400/85' : 'text-slate-400/80'
            }`}>{zhCN.resources.remainingCards(state.drawPile.length)}</span>
          </div>
        </div>

        {/* CENTER COLUMN: ACTIVE HAND CARDS & CONTROL BUTTONS */}
        <div className="flex flex-col items-center justify-center gap-3">
          {gameMode === 'CHALLENGE' && (
            <div className="fixed bottom-[18px] left-[max(18px,calc((100vw-1500px)/2+24px))] z-[24] w-[318px] rounded-lg border border-fuchsia-300/18 bg-[#120b1b]/82 px-2.5 py-2 font-mono shadow-[0_0_14px_rgba(168,85,247,0.10)]">
              <AnimatePresence>
                {dewdropFeedback && (
                  <motion.div
                    key={`dewdrop-feedback-${dewdropFeedback.token}`}
                    initial={{ opacity: 0, y: 8, scale: 0.9 }}
                    animate={{ opacity: [0, 1, 1, 0], y: [8, -2, -8, -14], scale: [0.9, 1.04, 1, 0.96] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.74, ease: 'easeOut' }}
                    className="absolute left-1/2 -top-14 z-[92] -translate-x-1/2 rounded-lg border border-emerald-300/35 bg-[#06130e]/94 px-3 py-2 text-center text-emerald-100 shadow-[0_0_22px_rgba(16,185,129,0.20)] pointer-events-none"
                  >
                    <div className="text-[11px] font-black tracking-widest">
                      {dewdropFeedback.type === 'gain' ? '🌿 露华' : '🌿 露珠生效'}
                    </div>
                    <div className="mt-1 text-[10px] font-bold text-emerald-100/75">
                      {dewdropFeedback.type === 'gain' ? `露珠 +${dewdropFeedback.amount}` : `HP +${dewdropFeedback.amount}`}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {sproutFeedback && (
                  <motion.div
                    key={`sprout-feedback-${sproutFeedback.token}`}
                    initial={{ opacity: 0, y: 8, scale: 0.9 }}
                    animate={{ opacity: [0, 1, 1, 0], y: [8, -2, -8, -14], scale: [0.9, 1.04, 1, 0.96] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.74, ease: 'easeOut' }}
                    className="absolute left-1/2 -top-[104px] z-[92] -translate-x-1/2 rounded-lg border border-emerald-300/35 bg-[#06130e]/94 px-3 py-2 text-center text-emerald-100 shadow-[0_0_22px_rgba(16,185,129,0.20)] pointer-events-none"
                  >
                    <div className="text-[11px] font-black tracking-widest">🌿 催芽</div>
                    <div className="mt-1 text-[10px] font-bold text-emerald-100/75">
                      {sproutFeedback.success ? '1 张森林幼苗已成熟' : '当前没有可成熟的森林幼苗'}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="mb-1 text-center text-[10px] font-black tracking-widest text-fuchsia-100/80">神明信仰</div>
              <div className="grid grid-cols-3 gap-1.5">
                {DEITY_ORDER.map(deityType => {
                  const deity = DEITY_CONFIG[deityType];
                  const faith = faithState[deityType];
                  const nextThreshold = getNextFaithThreshold(faith.level);
                  const showDewdrops = deityType === 'DEER_SPIRIT';
                  const showFrostSigils = deityType === 'FROST_LORD';
                  return (
                    <div key={deity.id} className="rounded-md border border-white/8 bg-black/20 px-1.5 py-1 text-center">
                      <div className="text-[10px] font-black tracking-wider text-white/85">{deity.icon} {deity.name}</div>
                      <div className="mt-0.5 text-[9px] font-extrabold text-fuchsia-100/75">Lv.{faith.level}</div>
                      <div className="mt-0.5 text-[8px] font-semibold text-white/45">
                        信仰：{nextThreshold === null ? 'MAX' : `${faith.faith} / ${nextThreshold}`}
                      </div>
                      {showDewdrops && (
                        <>
                          <div className="mt-0.5 text-[8px] font-semibold text-emerald-100/60">
                            露珠：{faith.level >= 1 ? `${playerDewdrops} / ${DEER_SPIRIT_CONFIG.dewdropLimit}` : '未解锁'}
                          </div>
                          <div className="mt-0.5 text-[8px] font-semibold text-emerald-100/50">
                            鹿角奔袭：{faith.level >= 3 ? (maxAntlerChargeHpCost > 0 ? '可用' : '生命不足') : '未解锁'}
                          </div>
                          {faith.level >= 4 && (
                            <div className="mt-0.5 text-[8px] font-semibold text-emerald-100/50">
                              万木奔涌：{hasTriggeredVerdantSurgeThisEnemy ? '本关已触发' : '本关就绪'}
                            </div>
                          )}
                        </>
                      )}
                      {showFrostSigils && (
                        <>
                          <div className="mt-0.5 text-[8px] font-semibold text-cyan-100/60">
                            ❄️ 霜签：{faith.level >= 1 ? `${playerFrostSigils} / ${FROST_LORD_CONFIG.frostSigilLimit}` : '未解锁'}
                          </div>
                          {faith.level >= 4 && (
                            <div className="mt-0.5 text-[8px] font-semibold text-cyan-100/50">
                              ❄️ 暴雪：{hasTriggeredBlizzardThisEnemy ? '本关已触发' : '本关就绪'}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className={`fixed bottom-[28px] right-[max(206px,calc((100vw-1500px)/2+206px))] z-[24] rounded-md border border-white/10 bg-black/28 px-2.5 py-1.5 text-[9px] font-mono font-bold text-white/75 tracking-wider leading-tight text-center transition-transform duration-200 ${playerMutationCountPulse ? 'scale-110' : 'scale-100'}`}>
            <div>异变牌：{playerMutationCount} / {mutationLimit}</div>
            <div className="mt-0.5 flex justify-center gap-2 text-[8px]">
              <span className="text-orange-200/85">🔥 {playerVolcanoMutationCount}</span>
              <span className="text-emerald-200/85">🌿 {playerForestMutationCount}</span>
              <span className="text-cyan-100/85">❄️ {playerGlacierMutationCount}</span>
            </div>
            {playerMutationCount >= mutationLimit && (
              <div className="mt-0.5 text-[9px] text-emerald-200/45">已达上限</div>
            )}
          </div>
          <div className="flex gap-4 min-h-[116px] items-center">
            {state.playerHand.length === 0 ? (
              <div className="flex flex-col items-center justify-center font-mono text-center border border-dashed border-red-500/20 px-8 py-4 rounded-xl bg-red-950/20 shadow-[0_0_12px_rgba(239,68,68,0.15)] animate-[pulse_2s_infinite]">
                <span className="text-red-500 text-xs font-black tracking-widest">{zhCN.notices.noCards}</span>
              </div>
            ) : (
              state.playerHand.map((card, idx) => {
                const isSelected = isRerollMode 
                  ? rerollSelectedCardId === card.id 
                  : selectedCards.includes(card.id);
                const interactive = isPlayerTurnState || isRerollMode;

                const isDefendPhase = state.phase === 'PLAYER_DEFEND';
                const maxTake = state.homePlayed.length;
                const hasReachedLimit = isDefendPhase && selectedCards.length >= maxTake;
                const isShaking = shakingCardIds[card.id];

                // Opacity and brightness classes for normal state or when limit is reached
                let customInteractiveClass = "";
                if (!interactive) {
                  customInteractiveClass = "cursor-not-allowed opacity-40";
                } else if (isDefendPhase && hasReachedLimit && !isSelected && !isRerollMode) {
                  customInteractiveClass = "cursor-pointer opacity-40 brightness-[0.7] hover:opacity-60 hover:brightness-[0.85] transition-all duration-305";
                } else {
                  customInteractiveClass = "cursor-pointer hover:border-accent hover:shadow-[0_0_12px_rgba(245,158,11,0.15)] opacity-100";
                }

                return (
                  <motion.div
                    key={card.id}
                    onClick={() => {
                      if (interactive) {
                        toggleSelect(card.id);
                      }
                    }}
                    className={`
                      card w-[90px] h-[120px] rounded-xl bg-surface border transition-all flex flex-col items-center justify-center relative card-shadow
                      ${isShaking ? 'animate-shake-card' : ''}
                      ${card.mutationType === 'VOLCANO' ? `lava-card ${mutatedCardGlowIds[card.id] ? 'lava-card--fresh' : ''}` : ''}
                      ${card.mutationType === 'FOREST' ? `forest-card forest-card--${card.forestGrowthStage === 'MATURE' ? 'mature' : 'seedling'} ${mutatedCardGlowIds[card.id] ? 'forest-card--fresh' : ''} ${maturedCardGlowIds[card.id] ? 'forest-card--growing' : ''}` : ''}
                      ${card.mutationType === 'GLACIER' ? `glacier-card ${card.glacierEchoUsed ? 'glacier-card--echo-used' : ''} ${mutatedCardGlowIds[card.id] ? 'glacier-card--fresh' : ''}` : ''}
                      ${customInteractiveClass}
                      ${getCardBorderClass(card.type)}
                      ${isSelected ? 'border-accent -translate-y-4 shadow-[0_0_20px_rgba(245,158,11,0.2)]' : 'border-border'}
                    `}
                  >
                    {maturedCardGlowIds[card.id] && (
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-md border border-emerald-400/35 bg-black/75 px-2 py-1 text-[10px] font-black tracking-widest text-emerald-200 shadow-[0_0_16px_rgba(16,185,129,0.22)] pointer-events-none">
                        🌿 已成熟
                      </div>
                    )}
                    <CardIcon type={card.type} className="relative z-10 text-4xl mb-2" />
                    <div className="text-[10px] font-bold tracking-wider text-text-dim">
                      {card.mutationType === 'VOLCANO'
                        ? volcanoCardLabel(card.type)
                        : card.mutationType === 'FOREST'
                          ? `${forestIcon(card)} ${forestCardLabel(card.type)}`
                          : card.mutationType === 'GLACIER'
                            ? `❄️ ${glacierCardLabel(card.type)}`
                          : cardLabel(card.type)}
                    </div>
                    {card.mutationType === 'FOREST' && (
                      <div className="mt-0.5 text-[9px] font-black tracking-widest text-emerald-200/85">
                        {forestStageLabel(card)}
                      </div>
                    )}
                    {card.mutationType === 'VOLCANO' && (
                      <div className="absolute top-1.5 right-1.5 text-[13px] leading-none drop-shadow-[0_0_6px_rgba(251,146,60,0.55)]" aria-hidden="true">
                        🔥
                      </div>
                    )}
                    {card.mutationType === 'FOREST' && (
                      <div className="absolute top-1.5 right-1.5 text-[13px] leading-none drop-shadow-[0_0_6px_rgba(52,211,153,0.55)]" aria-hidden="true">
                        {forestIcon(card)}
                      </div>
                    )}
                    {card.mutationType === 'GLACIER' && (
                      <div className="absolute top-1.5 right-1.5 text-[13px] leading-none drop-shadow-[0_0_6px_rgba(125,211,252,0.55)]" aria-hidden="true">
                        ❄️
                      </div>
                    )}
                    {card.mutationType === 'GLACIER' && card.glacierEchoUsed && (
                      <div className="absolute bottom-1.5 right-1.5 rounded border border-cyan-200/30 bg-[#06121a]/85 px-1.5 py-0.5 text-[7px] font-black tracking-wider text-cyan-50/80 shadow-[0_0_8px_rgba(125,211,252,0.15)] pointer-events-none">
                        ❄️ 1 / 1
                      </div>
                    )}
                  </motion.div>
                );
              })
            )}
          </div>

          <div className="flex flex-wrap justify-center gap-3 min-h-[40px] max-w-[680px]">
            {showResonancePreview && (
              <div className="absolute bottom-[84px] left-1/2 -translate-x-1/2 w-[220px] max-h-[44px] rounded-md border border-orange-500/25 bg-[#130b08]/88 px-2.5 py-1.5 text-center font-mono shadow-[0_0_12px_rgba(249,115,22,0.10)] pointer-events-none">
                <div className="text-[9.5px] font-black tracking-widest text-orange-200 leading-tight">{VOLCANO_ENVIRONMENT_CONFIG.icon} 灼烧共鸣已激活</div>
                <div className="mt-0.5 text-[8px] font-semibold text-orange-100/60 leading-tight">火山牌命中后额外造成 {VOLCANO_ENVIRONMENT_CONFIG.resonanceBonusDamage} 点伤害</div>
              </div>
            )}
            {showSymbiosisPreview && (
              <div className={`absolute ${showResonancePreview ? 'bottom-[132px]' : 'bottom-[84px]'} left-1/2 -translate-x-1/2 w-[250px] max-h-[48px] rounded-md border border-emerald-500/30 bg-[#07140f]/90 px-3 py-1.5 text-center font-mono shadow-[0_0_14px_rgba(16,185,129,0.12)] pointer-events-none`}>
                <div className="text-[9.5px] font-black tracking-widest text-emerald-200 leading-tight">🌿 共生绽放已激活</div>
                <div className="mt-0.5 text-[8px] font-semibold text-emerald-100/65 leading-tight">命中后恢复最多 2 HP</div>
                <div className="text-[8px] font-semibold text-emerald-100/50 leading-tight">下一次感染提前 1 轮</div>
              </div>
            )}
            {showGlacierEchoPreview && (
              <div className={`glacier-echo-preview absolute ${showResonancePreview || showSymbiosisPreview ? 'bottom-[132px]' : 'bottom-[84px]'} left-1/2 -translate-x-1/2 w-[280px] max-h-[48px] rounded-md border border-cyan-300/30 bg-[#06121a]/90 px-3 py-1.5 text-center font-mono shadow-[0_0_14px_rgba(34,211,238,0.12)] pointer-events-none`}>
                <div className="text-[9.5px] font-black tracking-widest text-cyan-100 leading-tight">❄️ 极寒回响待触发</div>
                <div className="mt-0.5 text-[8px] font-semibold text-cyan-50/65 leading-tight">至少 1 张冰川牌形成平局时，可保留 1 张异变牌</div>
              </div>
            )}
            {/* BUTTON 1: LEFT BUTTON */}
            {isRerollMode ? (
              <button 
                onClick={onCancelReroll}
                className="w-[180px] h-[40px] rounded-lg font-bold text-white bg-[#2d2d35] active:scale-95 cursor-pointer hover:bg-zinc-700 transition-colors flex flex-col items-center justify-center leading-tight shadow-md"
              >
                <span className="text-[12px] font-black tracking-widest">{zhCN.actions.cancel}</span>
              </button>
            ) : (
              <button 
                onClick={onStartRerollMode}
                disabled={playerHasRerolledThisTurn || !isPlayerTurnState || isProcessing || isSharedDeckUnavailable}
                title={isSharedDeckUnavailable ? zhCN.notices.rerollDeckEmpty : undefined}
                className="w-[180px] h-[40px] rounded-lg font-bold text-white bg-[#2d2d35]/50 border border-zinc-800/40 tracking-wider transition-all duration-200 hover:bg-zinc-700 active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:bg-[#1a1a20]/60 disabled:text-text-dim/20 disabled:border disabled:border-zinc-800/40 flex flex-col items-center justify-center leading-tight shadow-md"
              >
                <span className="text-[11px] font-black tracking-wider">
                  {zhCN.actions.rerollOne}
                </span>
              </button>
            )}

            {!isRerollMode && state.phase === 'PLAYER_DEFEND' && (
              <button
                type="button"
                onClick={onAbandonDefense}
                disabled={!isPlayerTurnState || isProcessing || state.winner !== null}
                className={`w-[150px] h-[40px] rounded-lg font-bold tracking-wider transition-all duration-200 active:scale-95 flex flex-col items-center justify-center leading-tight border
                  ${selectedCards.length > 0
                    ? 'bg-zinc-800/35 text-text-dim/45 border-zinc-700/35 cursor-pointer hover:border-zinc-500/40'
                    : 'bg-[#1f1410]/80 text-orange-100 border-orange-500/35 shadow-lg shadow-orange-500/10 hover:bg-[#2a1811] cursor-pointer'
                  }
                  ${(!isPlayerTurnState || isProcessing || state.winner !== null) ? 'opacity-40 cursor-not-allowed hover:border-zinc-700/35' : ''}
                `}
              >
                <span className="text-[11px] font-black tracking-wider">{zhCN.actions.pass}</span>
              </button>
            )}

            {canShowOfferingAction && (
              <button
                type="button"
                onClick={openOfferingPicker}
                className="w-[120px] h-[40px] rounded-lg border border-fuchsia-400/30 bg-[#1b1028]/80 text-fuchsia-100 font-black tracking-wider shadow-lg shadow-fuchsia-500/10 transition-all duration-200 hover:bg-[#261536] active:scale-95 disabled:opacity-35 disabled:cursor-not-allowed"
              >
                奉纳
              </button>
            )}

            {canShowCombustionAction && (
              <button
                type="button"
                onClick={releaseCombustion}
                title={combustionDisabledReason ?? undefined}
                aria-disabled={Boolean(combustionDisabledReason)}
                className={`w-[120px] h-[40px] rounded-lg border font-black tracking-wider transition-all duration-200 active:scale-95
                  ${combustionDisabledReason
                    ? 'border-zinc-700/45 bg-zinc-900/45 text-text-dim/35 cursor-pointer hover:border-orange-400/20'
                    : 'border-orange-400/40 bg-[#2a1108]/88 text-orange-100 shadow-lg shadow-orange-500/10 hover:bg-[#3a170a]'
                  }
                `}
              >
                🔥 爆燃
              </button>
            )}

            {canShowAntlerChargeAction && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (antlerChargeDisabledReason) {
                      showShortNotice(antlerChargeDisabledReason);
                      return;
                    }
                    setAntlerChargePickerOpen(prev => !prev);
                  }}
                  title={antlerChargeDisabledReason ?? undefined}
                  aria-disabled={Boolean(antlerChargeDisabledReason)}
                  className={`w-[128px] h-[40px] rounded-lg border font-black tracking-wider transition-all duration-200 active:scale-95
                    ${antlerChargeDisabledReason
                      ? 'border-zinc-700/45 bg-zinc-900/45 text-text-dim/35 cursor-pointer hover:border-emerald-400/20'
                      : 'border-emerald-400/40 bg-[#082015]/88 text-emerald-100 shadow-lg shadow-emerald-500/10 hover:bg-[#0d2b1c]'
                    }
                  `}
                >
                  🌿 鹿角奔袭
                </button>
                {faithState.DEER_SPIRIT.level >= 4 && (
                  <div className="absolute left-1/2 top-[44px] w-[110px] -translate-x-1/2 rounded border border-emerald-300/18 bg-black/35 px-1.5 py-0.5 text-center font-mono text-[7px] font-black tracking-wider text-emerald-100/55 pointer-events-none">
                    <div>🌿 万木奔涌</div>
                    <div>{hasTriggeredVerdantSurgeThisEnemy ? '本关已触发' : '本关就绪'}</div>
                  </div>
                )}
                <AnimatePresence>
                  {antlerChargePickerOpen && !antlerChargeDisabledReason && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.96 }}
                      transition={{ duration: 0.16 }}
                      className={`absolute bottom-[48px] left-1/2 z-[94] -translate-x-1/2 rounded-lg border border-emerald-300/25 bg-[#06130e]/96 p-2 text-center font-mono shadow-[0_0_22px_rgba(16,185,129,0.18)] ${antlerChargeMaxHpCost > 3 ? 'w-[360px]' : 'w-[226px]'}`}
                    >
                      <div className="text-[10px] font-black tracking-widest text-emerald-100/80">
                        {canUseVerdantSurge ? '🌿 万木奔涌' : '请选择消耗生命'}
                      </div>
                      <div className="mt-1 text-[8px] font-semibold text-emerald-100/45">
                        安全线：{Math.round(antlerChargeSafeHpRatio * 100)}% · 最多消耗：{antlerChargeMaxHpCost} HP
                      </div>
                      <div className={`mt-2 grid gap-1.5 ${antlerChargeMaxHpCost > 3 ? 'grid-cols-5' : 'grid-cols-3'}`}>
                        {Array.from({ length: antlerChargeMaxHpCost }, (_, index) => index + 1).map(cost => {
                          const disabled = cost > maxAntlerChargeHpCost;
                          const damage = cost * DEER_SPIRIT_CONFIG.chargeDamagePerHp;
                          return (
                            <button
                              key={cost}
                              type="button"
                              disabled={disabled}
                              onClick={() => releaseAntlerCharge(cost)}
                              className={`rounded-md border px-1.5 py-1.5 text-[9px] font-black leading-tight transition-all
                                ${disabled
                                  ? 'border-zinc-700/35 bg-zinc-900/35 text-text-dim/30 cursor-not-allowed'
                                  : 'border-emerald-300/35 bg-emerald-950/28 text-emerald-50 hover:bg-emerald-900/35'
                                }
                              `}
                            >
                              <div>消耗 {cost} HP</div>
                              <div className="mt-1 text-[8px] text-emerald-100/65">伤害 {damage}</div>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {canShowFrostSigilAction && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (frostSigilDisabledReason) {
                      showShortNotice(frostSigilDisabledReason);
                      return;
                    }
                    setFrostSigilPickerOpen(prev => !prev);
                  }}
                  title={frostSigilDisabledReason ?? undefined}
                  aria-disabled={Boolean(frostSigilDisabledReason)}
                  className={`w-[128px] h-[40px] rounded-lg border font-black tracking-wider transition-all duration-200 active:scale-95
                    ${frostSigilDisabledReason
                      ? 'border-zinc-700/45 bg-zinc-900/45 text-text-dim/35 cursor-pointer hover:border-cyan-400/20'
                      : 'border-cyan-300/40 bg-[#061521]/88 text-cyan-100 shadow-lg shadow-cyan-500/10 hover:bg-[#082134]'
                    }
                  `}
                >
                  ❄️ 释放霜签
                </button>
                <AnimatePresence>
                  {frostSigilPickerOpen && !frostSigilDisabledReason && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.96 }}
                      transition={{ duration: 0.16 }}
                      className="absolute bottom-[48px] left-1/2 z-[94] w-[236px] -translate-x-1/2 rounded-lg border border-cyan-300/25 bg-[#061521]/96 p-2 text-center font-mono shadow-[0_0_22px_rgba(34,211,238,0.18)]"
                    >
                      <div className="text-[10px] font-black tracking-widest text-cyan-100/80">❄️ 选择释放数量</div>
                      <div className="mt-2 grid grid-cols-4 gap-1.5">
                        {Array.from({ length: FROST_LORD_CONFIG.frostSigilLimit }, (_, index) => index + 1).map(amount => {
                          const disabled = amount > playerFrostSigils;
                          return (
                            <button
                              key={amount}
                              type="button"
                              disabled={disabled}
                              onClick={() => releaseFrostSigils(amount)}
                              className={`rounded-md border px-1 py-1.5 text-[9px] font-black leading-tight transition-all
                                ${disabled
                                  ? 'border-zinc-700/35 bg-zinc-900/35 text-text-dim/30 cursor-not-allowed'
                                  : 'border-cyan-300/35 bg-cyan-950/28 text-cyan-50 hover:bg-cyan-900/35'
                                }
                              `}
                            >
                              <div>释放 {amount} 枚</div>
                              <div className="mt-1 text-[8px] text-cyan-100/65">伤害 {amount}</div>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* BUTTON 2: RIGHT BUTTON */}
            {isRerollMode ? (
              <button 
                disabled={!rerollSelectedCardId || isProcessing}
                onClick={onConfirmReroll}
                className="w-[180px] h-[40px] rounded-lg font-bold text-black bg-amber-500 tracking-wider shadow-lg shadow-amber-500/15 active:scale-95 cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors flex flex-col items-center justify-center leading-tight animate-[pulse_1.5s_infinite]"
              >
                <span className="text-[12px] font-black tracking-widest">{zhCN.actions.confirmReroll}</span>
              </button>
            ) : (
              (() => {
                const isDefend = state.phase === 'PLAYER_DEFEND';
                const hasSelected = selectedCards.length > 0;
                
                // Disable confirm play if: not player state, or processing, or if not defend (meaning attack) and selectedCards.length is 0
                const rightDisabled = !isPlayerTurnState || isProcessing || selectedCards.length === 0 || state.winner !== null;

                let rightTextEng = zhCN.actions.confirmPlay;
                let rightTextChn = "";

                if (isDefend) {
                  if (hasSelected) {
                    rightTextEng = zhCN.actions.confirmDefense(selectedCards.length);
                    rightTextChn = "";
                  } else {
                    rightTextEng = zhCN.actions.confirmDefense(0);
                    rightTextChn = "";
                  }
                }

                return (
                  <button 
                    disabled={rightDisabled}
                    onClick={onPlay}
                    className={`w-[180px] h-[40px] rounded-lg font-bold text-black bg-accent tracking-wider transition-all duration-200 active:scale-95 cursor-pointer flex flex-col items-center justify-center leading-tight
                      ${rightDisabled 
                        ? 'bg-zinc-800/40 text-text-dim/20 border border-zinc-800/30 cursor-not-allowed shadow-none' 
                        : 'shadow-lg shadow-accent/15 hover:opacity-90'
                      }
                    `}
                  >
                    <span className="text-[12px] font-black tracking-wider">{rightTextEng}</span>
                    {rightTextChn && <span className="text-[9px] font-medium opacity-80">{rightTextChn}</span>}
                  </button>
                );
              })()
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: DISCARD PILE */}
        <div className="fixed bottom-[28px] right-[max(24px,calc((100vw-1500px)/2+24px))] z-[24] w-[90px] flex flex-col items-center justify-center select-none">
          <AnimatePresence>
            {playerDiscardPrompt && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="absolute bottom-[110px] bg-[#064e3b]/95 border border-emerald-500/30 rounded px-2.5 py-1.5 flex flex-col items-center select-none pointer-events-none font-mono text-emerald-400 font-bold leading-tight z-[30] min-w-[125px] text-center"
              >
                <span className="text-[9px] tracking-wider font-extrabold">{playerDiscardPrompt}</span>
                <span className="text-[8px] opacity-75 mt-0.5 font-bold">{zhCN.resources.playerDiscardUpdated}</span>
              </motion.div>
            )}
          </AnimatePresence>
          <div 
            onClick={() => {
              if (state.playerDiscardPile.length > 0) {
                setActiveDiscardModal('PLAYER');
              }
            }}
            className={`flex items-center gap-2.5 transition-all duration-300 ${state.playerDiscardPile.length === 0 ? 'opacity-30 cursor-not-allowed' : 'opacity-100 cursor-pointer hover:scale-[1.05]'}`}
          >
            {/* Numeric display on the left */}
            <div className="flex flex-col justify-center text-right font-mono">
              <span className="text-[9px] text-emerald-400 font-extrabold tracking-wider leading-none">{zhCN.resources.playerDiscard}</span>
              <span className="text-[8px] text-emerald-500/70 font-semibold leading-none mt-1">
                {zhCN.resources.totalCards(state.playerDiscardPile.length)}
              </span>
            </div>

            {/* graphics stack: matching AI discards size */}
            <div className="relative w-[42px] h-[56px] flex items-center justify-center">
              {/* Card 3 (Bottom) */}
              {state.playerDiscardPile.length > 2 && (
                <div className="absolute w-[38px] h-[52px] bg-zinc-900 border border-zinc-800 rounded -translate-x-1 translate-y-1 -rotate-6 opacity-30 shadow-sm" />
              )}
              {/* Card 2 (Middle) */}
              {state.playerDiscardPile.length > 1 && (
                <div className="absolute w-[40px] h-[54px] bg-zinc-800 border border-zinc-750 rounded -translate-x-0.5 translate-y-0.5 -rotate-3 opacity-60 shadow" />
              )}
              {/* Card 1 (Top) */}
              <div className="absolute w-[42px] h-[56px] bg-[#1a1a22] border border-emerald-500/25 rounded flex items-center justify-center shadow-md">
                <div className="flex flex-col items-center justify-center font-mono text-[9px] text-emerald-400/80">
                  <span className="text-sm leading-none">▼</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Floating Notice Bar (Warning Prompts) */}
      <AnimatePresence>
        {shortNotice && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute left-1/2 top-24 -translate-x-1/2 z-[100] px-5 py-2.5 bg-red-950/95 border border-red-500/40 text-red-200 rounded-lg text-xs font-mono tracking-wider shadow-[0_0_20px_rgba(239,68,68,0.25)] flex items-center gap-2 pointer-events-none"
          >
            <span className="text-sm">⚠️</span>
            <span className="font-bold">{shortNotice}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {forestRecoveryFeedback && (
          forestRecoveryFeedback.symbiosisByTarget.PLAYER || forestRecoveryFeedback.symbiosisByTarget.AI
        ) && (
          <motion.div
            key={`forest-symbiosis-burst-${forestRecoveryFeedback.token}`}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: [0, 1, 1, 0], y: [8, 0, -2, -6], scale: [0.96, 1, 1, 0.98] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="forest-symbiosis-burst absolute left-1/2 top-[286px] z-[118] -translate-x-1/2 rounded-lg border border-emerald-400/35 bg-[#06130e]/92 px-4 py-2 text-center font-mono shadow-[0_0_28px_rgba(16,185,129,0.18)] pointer-events-none"
          >
            <div className="forest-symbiosis-link" aria-hidden="true" />
            <div className="relative z-10 text-[12px] font-black tracking-widest text-emerald-200">
              🌿 {forestRecoveryFeedback.symbiosisByTarget.AI ? '对手触发共生绽放' : '共生绽放'}
            </div>
            <div className="relative z-10 mt-1 text-[10px] font-bold text-emerald-100/75">森林恢复：+2 HP</div>
            <div className="relative z-10 text-[9px] font-semibold text-emerald-100/55">下一次感染提前 1 轮</div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {antlerChargeFeedback && (
          <motion.div
            key={`antler-charge-${antlerChargeFeedback.token}`}
            initial={{ opacity: 0, y: 10, scale: 0.92 }}
            animate={{ opacity: [0, 1, 1, 0], y: [10, 0, -8, -16], scale: [0.92, 1.06, 1, 0.96] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            className="absolute left-1/2 top-[286px] z-[119] -translate-x-1/2 rounded-lg border border-emerald-300/40 bg-[#06130e]/94 px-4 py-2 text-center font-mono text-emerald-100 shadow-[0_0_30px_rgba(16,185,129,0.22)] pointer-events-none"
          >
            <div className="text-[13px] font-black tracking-widest">🌿 {antlerChargeFeedback.isSurge ? '万木奔涌' : '鹿角奔袭'}</div>
            <div className="mt-1 text-[10px] font-bold text-emerald-100/75">生命转化：{antlerChargeFeedback.hpCost}</div>
            <div className="text-[10px] font-bold text-emerald-100/75">造成伤害：{antlerChargeFeedback.damage}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {frostSigilFeedback && (
          <motion.div
            key={`frost-sigil-hit-${frostSigilFeedback.token}`}
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: [0, 1, 1, 0], y: [8, -2, -18, -30], scale: [0.9, 1.08, 1, 0.96] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.46, ease: 'easeOut' }}
            className="absolute left-1/2 top-[286px] z-[120] -translate-x-1/2 rounded-lg border border-cyan-300/40 bg-[#061521]/94 px-4 py-2 text-center font-mono text-cyan-100 shadow-[0_0_30px_rgba(34,211,238,0.22)] pointer-events-none"
          >
            <div className="text-[13px] font-black tracking-widest">❄️ 霜签</div>
            <div className="mt-1 text-[16px] font-black text-cyan-100">-1</div>
            <div className="text-[8px] font-semibold text-cyan-100/55">{frostSigilFeedback.hitIndex} / {frostSigilFeedback.totalHits}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {glacierRecycleFeedback && (
          <motion.div
            key={`glacier-recycle-${glacierRecycleFeedback.token}`}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: [0, 1, 1, 0], y: [8, 0, -2, -6], scale: [0.96, 1, 1, 0.98] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.85, ease: 'easeOut' }}
            className="glacier-recycle-burst absolute left-1/2 top-[286px] z-[118] -translate-x-1/2 rounded-lg border border-cyan-300/35 bg-[#06121a]/92 px-4 py-2 text-center font-mono shadow-[0_0_24px_rgba(34,211,238,0.16)] pointer-events-none"
          >
            <div className="glacier-recycle-path" aria-hidden="true" />
            {glacierRecycleFeedback.echoByTarget?.AI ? (
              <>
                <div className="relative z-10 text-[12px] font-black tracking-widest text-cyan-50">❄️ 对手触发极寒回响</div>
                <div className="relative z-10 mt-1 text-[10px] font-bold text-cyan-50/72">1 张冰川牌保留异变属性</div>
              </>
            ) : glacierRecycleFeedback.echoByTarget?.PLAYER ? (
              <>
                <div className="relative z-10 text-[12px] font-black tracking-widest text-cyan-50">❄️ 极寒回响</div>
                <div className="relative z-10 mt-1 text-[10px] font-bold text-cyan-50/72">1 张冰川牌保留异变属性</div>
              </>
            ) : glacierRecycleFeedback.targets.includes('AI') && !glacierRecycleFeedback.targets.includes('PLAYER') ? (
              <>
                <div className="relative z-10 text-[12px] font-black tracking-widest text-cyan-100">❄️ 对手回收 1 张冰川牌</div>
                <div className="relative z-10 mt-1 text-[10px] font-bold text-cyan-50/72">冰川牌返回手牌</div>
              </>
            ) : (
              <>
                <div className="relative z-10 text-[12px] font-black tracking-widest text-cyan-100">❄️ 冰封回收</div>
                <div className="relative z-10 mt-1 text-[10px] font-bold text-cyan-50/72">冰川牌返回手牌</div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {environmentSwitchNotice && (
          <motion.div
            key={`environment-switch-${environmentSwitchNotice.token}`}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: [0, 1, 1, 0], y: [8, 0, -2, -6], scale: [0.96, 1, 1, 0.98] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.85, ease: 'easeOut' }}
            className="absolute left-1/2 top-[242px] z-[119] -translate-x-1/2 rounded-lg border border-white/15 bg-[#080a0f]/92 px-4 py-2 text-center font-mono shadow-[0_0_24px_rgba(0,0,0,0.35)] pointer-events-none"
          >
            <div className="text-[12px] font-black tracking-widest text-white/90">环境切换</div>
            <div className="mt-1 text-[10px] font-bold text-white/70">
              {ENVIRONMENT_CONFIG_BY_ID[environmentSwitchNotice.from].icon} {environmentLabel(environmentSwitchNotice.from)}
              <span className="mx-2 text-white/40">→</span>
              {ENVIRONMENT_CONFIG_BY_ID[environmentSwitchNotice.to].icon} {environmentLabel(environmentSwitchNotice.to)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {challengeStageNotice && (
          <motion.div
            key={`challenge-stage-${challengeStageNotice.token}`}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: [0, 1, 1, 0], y: [8, 0, -2, -6], scale: [0.96, 1, 1, 0.98] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.85, ease: 'easeOut' }}
            className="absolute left-1/2 top-[242px] z-[120] -translate-x-1/2 rounded-lg border border-fuchsia-300/25 bg-[#100b14]/92 px-4 py-2 text-center font-mono shadow-[0_0_24px_rgba(217,70,239,0.14)] pointer-events-none"
          >
            <div className="text-[12px] font-black tracking-widest text-fuchsia-100">第 {challengeStageNotice.stage} 关</div>
            <div className="mt-1 text-[10px] font-bold text-fuchsia-100/70">新的对手已进入战场</div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {offeringPickerCardId && (() => {
          const offeringCard = state.playerHand.find(card => card.id === offeringPickerCardId);
          if (!offeringCard?.mutationType) return null;
          return (
            <div className="absolute inset-0 z-[130] flex items-center justify-center pointer-events-none">
              <motion.div
                initial={{ scale: 0.96, opacity: 0, y: 8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 6 }}
                transition={{ duration: 0.18 }}
                className="w-[430px] rounded-xl border border-fuchsia-300/30 bg-[#100918]/94 p-5 text-center font-mono shadow-[0_18px_50px_rgba(0,0,0,0.45),0_0_24px_rgba(168,85,247,0.14)] backdrop-blur-md pointer-events-auto"
              >
                <h3 className="text-sm font-black tracking-widest text-fuchsia-100">请选择奉纳对象</h3>
                <p className="mt-1 text-[10px] font-semibold text-fuchsia-100/55">
                  {mutationCardLabel(offeringCard.mutationType, offeringCard.type)}
                </p>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  {DEITY_ORDER.map(deityType => {
                    const deity = DEITY_CONFIG[deityType];
                    const gain = getOfferingFaithGain(offeringCard, deity);
                    const sameEnvironment = gain === 2;
                    return (
                      <button
                        key={deity.id}
                        type="button"
                        onClick={() => confirmOffering(deity.id)}
                        className="rounded-lg border border-white/10 bg-black/24 px-2 py-3 text-center transition-all hover:-translate-y-0.5 hover:border-fuchsia-200/35 hover:bg-fuchsia-950/25"
                      >
                        <div className="text-xl">{deity.icon}</div>
                        <div className="mt-1 text-[11px] font-black tracking-wider text-white/85">{deity.name}</div>
                        <div className={`mt-1 text-[9px] font-bold ${sameEnvironment ? 'text-fuchsia-100/85' : 'text-white/45'}`}>
                          {sameEnvironment ? '同环境' : '异环境'}：+{gain} 信仰
                        </div>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setOfferingPickerCardId(null)}
                  className="mt-4 h-8 rounded-md border border-white/10 bg-white/5 px-4 text-[10px] font-bold tracking-wider text-white/55 hover:text-white/80"
                >
                  取消
                </button>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      <AnimatePresence>
        {glacierEchoCandidates.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-[142] pointer-events-none">
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0, y: 6 }}
              transition={{ duration: 0.18 }}
              className="glacier-echo-modal relative overflow-hidden w-[420px] rounded-xl border border-cyan-300/35 bg-[#06121a]/94 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.45),0_0_24px_rgba(34,211,238,0.14)] backdrop-blur-md font-mono text-center pointer-events-auto"
            >
              <h3 className="text-cyan-100 text-sm font-black tracking-widest">❄️ 极寒回响</h3>
              <p className="mt-1 text-[11px] text-cyan-50/75 font-semibold">请选择 1 张冰川牌保留异变属性</p>
              <div className="mt-5 flex items-center justify-center gap-4">
                {glacierEchoCandidates.map(card => (
                  <button
                    key={card.id}
                    onClick={() => handleGlacierEchoPick(card.id)}
                    title={`返回手牌后仍保留冰川属性\n每张冰川牌最多保留 1 次`}
                    className={`glacier-echo-candidate group w-[126px] h-[154px] rounded-xl bg-surface border border-cyan-300/30 flex flex-col items-center justify-center relative card-shadow cursor-pointer hover:border-cyan-200 hover:-translate-y-1 transition-all ${getCardBorderClass(card.type)}`}
                  >
                    <div className="absolute top-2 right-2 text-[14px] drop-shadow-[0_0_6px_rgba(125,211,252,0.45)]" aria-hidden="true">❄️</div>
                    <CardIcon type={card.type} className="text-4xl mb-2" />
                    <div className="text-[10px] font-bold tracking-wider text-text-dim leading-relaxed">
                      <div>{glacierCardLabel(card.type)}</div>
                      <div className="text-cyan-100/90">保留冰川属性</div>
                    </div>
                    <div className="absolute -bottom-16 left-1/2 hidden w-[176px] -translate-x-1/2 rounded-md border border-cyan-300/25 bg-[#111]/95 px-2 py-1.5 text-[9px] leading-relaxed text-cyan-50/75 shadow-xl group-hover:block">
                      <div>返回手牌后仍保留冰川属性</div>
                      <div className="text-cyan-50/55">每张冰川牌最多保留 1 次</div>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Forest mutation selection */}
      <AnimatePresence>
        {mutationCandidates.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-[140] pointer-events-none">
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0, y: 6 }}
              transition={{ duration: 0.18 }}
              className={`w-[420px] rounded-xl border ${isVolcanoEnvironment ? 'border-orange-500/35 bg-[#130b08]/92 shadow-[0_18px_50px_rgba(0,0,0,0.45),0_0_24px_rgba(249,115,22,0.12)]' : isGlacierEnvironment ? 'border-cyan-300/35 bg-[#06121a]/92 shadow-[0_18px_50px_rgba(0,0,0,0.45),0_0_24px_rgba(34,211,238,0.12)]' : 'border-emerald-500/35 bg-[#07120d]/92 shadow-[0_18px_50px_rgba(0,0,0,0.45),0_0_24px_rgba(16,185,129,0.12)]'} p-5 backdrop-blur-md font-mono text-center pointer-events-auto`}
            >
              <h3 className={`${isVolcanoEnvironment ? 'text-orange-200' : isGlacierEnvironment ? 'text-cyan-100' : 'text-emerald-200'} text-sm font-black tracking-widest`}>
                {activeEnvironmentConfig.icon} {activeMutationLabel}感染
              </h3>
              <p className={`mt-1 text-[11px] ${isVolcanoEnvironment ? 'text-orange-100/75' : isGlacierEnvironment ? 'text-cyan-50/75' : 'text-emerald-100/75'} font-semibold`}>
                请选择 1 张手牌感染为{isVolcanoEnvironment ? '火山牌' : isGlacierEnvironment ? '冰川牌' : '森林幼苗'}
              </p>
              <div className="mt-5 flex items-center justify-center gap-4">
                {mutationCandidates.map(card => (
                  <button
                    key={card.id}
                    onClick={() => handleMutationPick(card.id)}
                    title={isVolcanoEnvironment
                      ? `感染后：\n🔥 ${volcanoCardLabel(card.type)}\n\n命中时：\n触发火山附加伤害`
                      : isGlacierEnvironment
                        ? `感染后：\n❄️ ${glacierCardLabel(card.type)}\n\n与敌方卡牌平局时：\n返回手牌并恢复为普通牌`
                        : `感染后：\n🌱 ${forestCardLabel(card.type)}·幼苗\n\n完整保留 1 次交锋后成熟\n成熟后命中可恢复 HP`
                    }
                    className={`group w-[126px] h-[154px] rounded-xl bg-surface border ${isVolcanoEnvironment ? 'border-orange-500/30 hover:border-orange-300' : isGlacierEnvironment ? 'border-cyan-300/30 hover:border-cyan-200' : 'border-emerald-500/30 hover:border-emerald-300'} flex flex-col items-center justify-center relative card-shadow cursor-pointer hover:-translate-y-1 transition-all ${getCardBorderClass(card.type)}`}
                  >
                    <div className={`absolute top-2 right-2 text-[14px] ${isVolcanoEnvironment ? 'drop-shadow-[0_0_6px_rgba(251,146,60,0.45)]' : isGlacierEnvironment ? 'drop-shadow-[0_0_6px_rgba(125,211,252,0.45)]' : 'drop-shadow-[0_0_6px_rgba(52,211,153,0.45)]'}`} aria-hidden="true">
                      {isVolcanoEnvironment ? '🔥' : isGlacierEnvironment ? '❄️' : '🌱'}
                    </div>
                    <CardIcon type={card.type} className="text-4xl mb-2" />
                    <div className="text-[10px] font-bold tracking-wider text-text-dim leading-relaxed">
                      <div>普通{plainCardLabel(card.type)}</div>
                      <div className={isVolcanoEnvironment ? 'text-orange-200/90' : isGlacierEnvironment ? 'text-cyan-100/90' : 'text-emerald-200/90'}>
                        → {isForestEnvironment ? `${forestCardLabel(card.type)}·幼苗` : activeMutationCardLabel(card.type)}
                      </div>
                    </div>
                    <div className={`absolute -bottom-20 left-1/2 hidden w-[188px] -translate-x-1/2 rounded-md border ${isVolcanoEnvironment ? 'border-orange-500/25 text-orange-100/75' : isGlacierEnvironment ? 'border-cyan-300/25 text-cyan-50/75' : 'border-emerald-500/25 text-emerald-100/75'} bg-[#111]/95 px-2 py-1.5 text-[9px] leading-relaxed shadow-xl group-hover:block`}>
                      <div className={`font-black ${isVolcanoEnvironment ? 'text-orange-200' : isGlacierEnvironment ? 'text-cyan-100' : 'text-emerald-200'}`}>感染后：</div>
                      <div>{isVolcanoEnvironment ? '🔥' : isGlacierEnvironment ? '❄️' : '🌱'} {isForestEnvironment ? `${forestCardLabel(card.type)}·幼苗` : activeMutationCardLabel(card.type)}</div>
                      {isVolcanoEnvironment ? (
                        <>
                          <div className="mt-1 text-orange-100/55">命中时：</div>
                          <div className="text-orange-100/55">触发火山附加伤害</div>
                        </>
                      ) : isGlacierEnvironment ? (
                        <>
                          <div className="mt-1 text-cyan-50/55">与敌方卡牌平局时：</div>
                          <div className="text-cyan-50/55">返回手牌并恢复为普通牌</div>
                        </>
                      ) : (
                        <>
                          <div className="mt-1 text-emerald-100/55">完整保留 1 次交锋后成熟</div>
                          <div className="text-emerald-100/55">成熟后命中可恢复 HP</div>
                        </>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Draw Pile Supply dry validation dialog */}
      <AnimatePresence>
        {drawWarningPopUp && (
          <div className="absolute inset-0 bg-[#0a0a0b]/85 backdrop-blur-sm flex items-center justify-center z-[150]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-[380px] bg-[#121216] border border-red-500/45 p-6 rounded-xl shadow-2xl flex flex-col items-center text-center font-mono"
            >
              <div className="w-12 h-12 rounded-full bg-red-950/50 border border-red-500/40 flex items-center justify-center text-red-500 text-2xl mb-4 animate-pulse">
                ⚠️
              </div>
              <h3 className="text-red-400 font-bold tracking-widest text-sm mb-1">
                {zhCN.notices.drawPileEmpty}
              </h3>
              <p className="text-[11px] text-text-dim/80 mb-5 leading-relaxed">
                {zhCN.notices.drawPileEmptyDetail}
              </p>
              <button
                onClick={() => setDrawWarningPopUp(false)}
                className="w-full py-2 bg-red-950/20 hover:bg-red-900/45 border border-red-500/30 font-bold tracking-widest text-[10px] text-red-400 rounded-lg transition-all active:scale-95"
              >
                {zhCN.actions.acknowledge}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Discard Pile View Modal */}
      <AnimatePresence>
        {activeDiscardModal && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[110]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-[280px] bg-[#101014]/95 border border-zinc-750 p-5 rounded-xl shadow-2xl flex flex-col font-mono"
            >
              <div className="flex justify-between items-center mb-4 pb-1.5 border-b border-white/[0.06]">
                <div className="text-left">
                  <h4 className="text-[11px] font-bold tracking-widest text-text-dim">
                    {activeDiscardModal === 'PLAYER' ? zhCN.resources.playerDiscard : zhCN.resources.aiDiscard}
                  </h4>
                  <p className="text-[9px] text-text-dim/50 leading-none">
                    {activeDiscardModal === 'PLAYER' ? '我方弃牌构成' : '敌方弃牌构成'}
                  </p>
                </div>
                <button
                  onClick={() => setActiveDiscardModal(null)}
                  className="w-5 h-5 rounded hover:bg-white/10 flex items-center justify-center text-text-dim hover:text-white transition-colors cursor-pointer text-xs"
                >
                  ✕
                </button>
              </div>

              {(() => {
                const pile = activeDiscardModal === 'PLAYER' ? state.playerDiscardPile : state.aiDiscardPile;
                
                // Safety check
                const stats = { ROCK: 0, SCISSORS: 0, PAPER: 0 };
                if (pile) {
                  pile.forEach(c => {
                    if (stats[c.type] !== undefined) {
                      stats[c.type]++;
                    }
                  });
                }

                return (
                  <div className="space-y-3 py-1">
                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-base select-none">✊</span>
                        <span className="text-text-dim/80">{zhCN.cards.ROCK}</span>
                      </div>
                      <span className="font-bold text-[#e5e5eb] font-mono">× {stats.ROCK}</span>
                    </div>
                    
                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-base select-none">✌️</span>
                        <span className="text-text-dim/80">{zhCN.cards.SCISSORS}</span>
                      </div>
                      <span className="font-bold text-[#e5e5eb] font-mono">× {stats.SCISSORS}</span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-base select-none">✋</span>
                        <span className="text-text-dim/80">{zhCN.cards.PAPER}</span>
                      </div>
                      <span className="font-bold text-[#e5e5eb] font-mono">× {stats.PAPER}</span>
                    </div>

                    <div className="pt-2 text-[8px] text-text-dim/40 text-center uppercase tracking-widest border-t border-white/[0.04]">
                      Total: {pile ? pile.length : 0} Cards
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Scorching resonance visual layer */}
      <div className="absolute inset-0 pointer-events-none z-[146] overflow-hidden">
        <AnimatePresence>
          {resonanceAnimation && (
            <motion.div
              key={`resonance-${resonanceAnimation.token}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.72, ease: 'easeOut' }}
              className="absolute inset-0"
            >
              <div className="absolute left-1/2 top-[330px] h-[2px] w-[180px] -translate-x-1/2 bg-gradient-to-r from-transparent via-orange-400/80 to-transparent shadow-[0_0_18px_rgba(249,115,22,0.55)]" />
              <div className="absolute left-1/2 top-[292px] -translate-x-1/2 rounded-full border border-orange-500/35 bg-[#180904]/90 px-4 py-2 text-center font-mono shadow-[0_0_28px_rgba(249,115,22,0.28)]">
                <div className="text-[12px] font-black tracking-widest text-orange-200">{VOLCANO_ENVIRONMENT_CONFIG.icon} 灼烧共鸣</div>
              </div>
              <div className={`absolute ${resonanceAnimation.target === 'AI' ? 'left-[610px] top-[104px] text-orange-300' : 'left-[610px] bottom-[132px] text-red-300'} rounded-md border border-orange-500/30 bg-black/70 px-2 py-1 font-mono text-[12px] font-black shadow-[0_0_18px_rgba(249,115,22,0.2)]`}>
                灼烧 -1
              </div>
              <span className="absolute left-[45%] top-[315px] text-[12px] drop-shadow-[0_0_8px_rgba(251,146,60,0.8)]">{VOLCANO_ENVIRONMENT_CONFIG.icon}</span>
              <span className="absolute left-[52%] top-[338px] text-[10px] opacity-80 drop-shadow-[0_0_8px_rgba(251,146,60,0.7)]">{VOLCANO_ENVIRONMENT_CONFIG.icon}</span>
              <span className="absolute left-[49%] top-[358px] text-[9px] opacity-70 drop-shadow-[0_0_8px_rgba(251,146,60,0.7)]">{VOLCANO_ENVIRONMENT_CONFIG.icon}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Volcano mutation animation layer */}
      <div className="absolute inset-0 pointer-events-none z-[145] overflow-hidden">
        <AnimatePresence>
          {mutationAnimation?.side === 'PLAYER' && (() => {
            const targetIndex = Math.max(0, state.playerHand.findIndex(card => card.id === mutationAnimation.cardId));
            const handCenterOffset = (targetIndex - (state.playerHand.length - 1) / 2) * 106;
            return (
              <motion.div
                key={`player-mutation-${mutationAnimation.token}`}
                className="absolute left-1/2 top-[116px] h-3 w-3"
                initial={{ x: -6, y: 0, opacity: 0 }}
                animate={{
                  x: handCenterOffset - 6,
                  y: 512,
                  opacity: [0, 1, 1, 0],
                  scale: [0.75, 1.15, 0.9],
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.62, ease: 'easeInOut' }}
              >
                <span className={`absolute text-[15px] ${isGlacierEnvironment ? 'drop-shadow-[0_0_8px_rgba(125,211,252,0.8)]' : 'drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]'}`}>
                  {isVolcanoEnvironment ? '🔥' : isGlacierEnvironment ? '❄️' : '🌱'}
                </span>
                <span className={`absolute -left-5 top-4 text-[10px] opacity-75 ${isGlacierEnvironment ? 'drop-shadow-[0_0_6px_rgba(125,211,252,0.65)]' : 'drop-shadow-[0_0_6px_rgba(52,211,153,0.65)]'}`}>
                  {activeEnvironmentConfig.icon}
                </span>
                <span className={`absolute left-5 top-7 text-[9px] opacity-60 ${isGlacierEnvironment ? 'drop-shadow-[0_0_6px_rgba(125,211,252,0.65)]' : 'drop-shadow-[0_0_6px_rgba(52,211,153,0.65)]'}`}>
                  {isVolcanoEnvironment ? '🔥' : isGlacierEnvironment ? '❄️' : '🌱'}
                </span>
              </motion.div>
            );
          })()}

          {mutationAnimation?.side === 'AI' && (
            <motion.div
              key={`ai-mutation-${mutationAnimation.token}`}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: [0, 0.55, 0.25, 0], scale: [0.96, 1.02, 1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.62, ease: 'easeOut' }}
              className={`absolute left-1/2 top-[86px] -translate-x-1/2 w-[260px] h-[86px] rounded-full border ${isGlacierEnvironment ? 'border-cyan-300/20 bg-cyan-300/[0.08] shadow-[0_0_30px_rgba(34,211,238,0.18)] text-cyan-100/85' : 'border-emerald-500/20 bg-emerald-500/[0.08] shadow-[0_0_30px_rgba(16,185,129,0.22)] text-emerald-200/85'} flex items-center justify-center font-mono text-[11px] font-black tracking-wider`}
            >
              对手获得 1 张异变牌
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Animation overlay layer */}
      <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
        <AnimatePresence>
          {activeAnims.map(anim => {
            const isShuffle = anim.type === 'SHUFFLE';

            return (
              <motion.div
                key={anim.id}
                initial={{ x: anim.startX, y: anim.startY, opacity: 1, scale: 0.8 }}
                animate={{ x: anim.endX, y: anim.endY, opacity: [1, 1, 0.3], scale: [0.8, 1.02, 0.75] }}
                exit={{ opacity: 0 }}
                transition={{ duration: isShuffle ? 0.7 : 0.55, ease: "easeInOut" }}
                onAnimationComplete={() => removeAnimation(anim.id)}
                className="absolute w-[65px] h-[90px] rounded-lg bg-[#141417] border border-border flex flex-col items-center justify-center shadow-2xl z-50 select-none pointer-events-none"
                style={{ left: 0, top: 0 }}
              >
                {anim.cardType ? (
                  <div className="flex flex-col items-center justify-center">
                    <CardIcon type={anim.cardType} className="text-2xl" />
                    <span className="text-[7.5px] font-black tracking-wider opacity-40 mt-1">{cardLabel(anim.cardType)}</span>
                  </div>
                ) : (
                  <div className="text-xl text-text-dim/30">🎴</div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #2d2d35; border-radius: 2px; }

        @keyframes shake-card-kf {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        .animate-shake-card {
          animation: shake-card-kf 0.3s ease-in-out;
        }

        @keyframes hp-shake-kf {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-5px); }
          40%, 80% { transform: translateX(5px); }
        }
        .animate-hp-shake {
          animation: hp-shake-kf 0.3s ease-in-out;
        }

        .burn-hp-feedback {
          background: rgba(249, 115, 22, 0.10);
          border-color: rgba(249, 115, 22, 0.55) !important;
          box-shadow: 0 0 18px rgba(249, 115, 22, 0.24), inset 0 0 0 1px rgba(251, 146, 60, 0.12);
        }

        .forest-recovery-hp-feedback {
          background: rgba(16, 185, 129, 0.08);
          border-color: rgba(52, 211, 153, 0.45) !important;
          box-shadow: 0 0 18px rgba(16, 185, 129, 0.22), inset 0 0 0 1px rgba(52, 211, 153, 0.10);
          animation: forest-hp-pulse 0.72s ease-out;
        }

        .animate-burn-hp-shake {
          animation: burn-hp-shake-kf 0.72s ease-out;
        }

        @keyframes burn-hp-shake-kf {
          0%, 100% { transform: translateX(0); }
          16% { transform: translateX(-4px); }
          32% { transform: translateX(4px); }
          48% { transform: translateX(-2px); }
          64% { transform: translateX(2px); }
        }

        @keyframes forest-hp-pulse {
          0%, 100% { box-shadow: 0 0 12px rgba(16, 185, 129, 0.10), inset 0 0 0 1px rgba(52, 211, 153, 0.08); }
          42% { box-shadow: 0 0 24px rgba(16, 185, 129, 0.30), inset 0 0 0 1px rgba(110, 231, 183, 0.24); }
        }

        .volcano-event-panel {
          animation: volcano-breathe 3.8s ease-in-out infinite;
        }

        .volcano-event-panel--pulse {
          animation: volcano-event-pulse 0.78s ease-in-out;
        }

        .route-event-panel {
          overflow: hidden;
          background: rgba(8, 10, 15, 0.92);
          box-shadow: 0 0 16px rgba(255,255,255,0.05), inset 0 0 18px rgba(255,255,255,0.03);
        }

        .route-event-panel::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0.22;
          background:
            radial-gradient(circle at 16% 24%, rgba(255,255,255,0.20) 0 1px, transparent 2px),
            radial-gradient(circle at 84% 74%, rgba(255,255,255,0.14) 0 1px, transparent 2px),
            linear-gradient(118deg, transparent 0 30%, rgba(255,255,255,0.11) 30.5% 31.5%, transparent 32% 100%);
        }

        .route-event-panel--volcano {
          border-color: rgba(249, 115, 22, 0.36);
          background: rgba(19, 11, 8, 0.92);
          box-shadow: 0 0 16px rgba(249,115,22,0.12), inset 0 0 18px rgba(249,115,22,0.04);
        }

        .route-event-panel--forest {
          border-color: rgba(16, 185, 129, 0.34);
          background: rgba(6, 19, 14, 0.92);
          box-shadow: 0 0 16px rgba(16,185,129,0.12), inset 0 0 18px rgba(16,185,129,0.04);
        }

        .route-event-panel--glacier {
          border-color: rgba(125, 211, 252, 0.34);
          background: rgba(6, 18, 26, 0.92);
          box-shadow: 0 0 16px rgba(34,211,238,0.12), inset 0 0 18px rgba(34,211,238,0.04);
        }

        .route-event-panel--pulse {
          animation: route-event-pulse 0.78s ease-in-out;
        }

        .forest-event-panel {
          overflow: hidden;
          animation: forest-breathe 3.8s ease-in-out infinite;
        }

        .forest-event-panel::before {
          content: "";
          position: absolute;
          inset: 0;
          opacity: 0.26;
          pointer-events: none;
          background:
            radial-gradient(circle at 18% 24%, rgba(52, 211, 153, 0.18) 0 1px, transparent 2px),
            radial-gradient(circle at 78% 68%, rgba(110, 231, 183, 0.16) 0 1px, transparent 2px),
            linear-gradient(128deg, transparent 0 18%, rgba(52, 211, 153, 0.14) 18.5% 19.5%, transparent 20% 100%),
            linear-gradient(32deg, transparent 0 72%, rgba(16, 185, 129, 0.14) 72.5% 73.5%, transparent 74% 100%);
        }

        .forest-event-leaf {
          position: absolute;
          top: 8px;
          color: rgba(110, 231, 183, 0.34);
          font-size: 24px;
          line-height: 1;
          pointer-events: none;
          transform: rotate(-18deg);
        }

        .forest-event-leaf--left { left: 10px; }
        .forest-event-leaf--right { right: 10px; transform: rotate(18deg) scaleX(-1); }

        .glacier-event-crystal {
          position: absolute;
          top: 8px;
          color: rgba(186, 230, 253, 0.36);
          font-size: 18px;
          line-height: 1;
          pointer-events: none;
          filter: drop-shadow(0 0 6px rgba(125, 211, 252, 0.22));
        }

        .forest-event-panel--pulse {
          animation: forest-event-pulse 0.78s ease-in-out;
        }

        .glacier-event-panel {
          overflow: hidden;
          animation: glacier-breathe 3.8s ease-in-out infinite;
        }

        .glacier-event-panel::before {
          content: "";
          position: absolute;
          inset: 0;
          opacity: 0.24;
          pointer-events: none;
          background:
            radial-gradient(circle at 18% 24%, rgba(125, 211, 252, 0.20) 0 1px, transparent 2px),
            radial-gradient(circle at 78% 68%, rgba(186, 230, 253, 0.16) 0 1px, transparent 2px),
            linear-gradient(125deg, transparent 0 28%, rgba(125, 211, 252, 0.14) 28.5% 29.5%, transparent 30% 100%),
            linear-gradient(35deg, transparent 0 70%, rgba(34, 211, 238, 0.13) 70.5% 71.5%, transparent 72% 100%);
        }

        .glacier-event-panel::after {
          content: "";
          position: absolute;
          inset: 2px;
          border-radius: 5px;
          pointer-events: none;
          opacity: 0.34;
          background:
            linear-gradient(90deg, rgba(186, 230, 253, 0.18), transparent 18%, transparent 82%, rgba(125, 211, 252, 0.16)),
            linear-gradient(0deg, rgba(186, 230, 253, 0.13), transparent 22%, transparent 78%, rgba(125, 211, 252, 0.12));
        }

        .glacier-event-panel--pulse {
          animation: glacier-event-pulse 0.78s ease-in-out;
        }

        .lava-card {
          border-color: rgba(249, 115, 22, 0.55) !important;
          box-shadow: inset 0 0 0 1px rgba(251, 146, 60, 0.16), 0 0 13px rgba(249, 115, 22, 0.12);
          animation: lava-card-breathe 4.2s ease-in-out infinite;
          overflow: hidden;
        }

        .lava-card::before {
          content: "";
          position: absolute;
          inset: 5px;
          border-radius: 9px;
          pointer-events: none;
          opacity: 0.52;
          background:
            linear-gradient(118deg, transparent 0 24%, rgba(251, 146, 60, 0.35) 24.5% 25.5%, transparent 26% 100%),
            linear-gradient(42deg, transparent 0 56%, rgba(239, 68, 68, 0.28) 56.5% 57.5%, transparent 58% 100%),
            linear-gradient(165deg, transparent 0 68%, rgba(251, 191, 36, 0.24) 68.5% 69.5%, transparent 70% 100%);
        }

        .lava-card--fresh {
          animation: lava-card-arrive 0.9s ease-out, lava-card-breathe 4.2s ease-in-out infinite 0.9s;
        }

        .forest-card {
          border-color: rgba(16, 185, 129, 0.55) !important;
          box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.15), 0 0 12px rgba(16, 185, 129, 0.11);
          overflow: hidden;
        }

        .forest-card.border-accent {
          border-color: rgb(245, 158, 11) !important;
        }

        .forest-card::before,
        .forest-card::after {
          content: "";
          position: absolute;
          inset: 6px;
          border-radius: 9px;
          pointer-events: none;
        }

        .forest-card::before {
          opacity: 0.42;
          background:
            radial-gradient(circle at 9% 18%, rgba(134, 239, 172, 0.36) 0 1px, transparent 2px),
            radial-gradient(circle at 12% 78%, rgba(134, 239, 172, 0.28) 0 1px, transparent 2px),
            radial-gradient(circle at 88% 24%, rgba(134, 239, 172, 0.28) 0 1px, transparent 2px),
            radial-gradient(circle at 84% 82%, rgba(134, 239, 172, 0.24) 0 1px, transparent 2px);
        }

        .forest-card::after {
          opacity: 0.34;
          background:
            linear-gradient(90deg, rgba(52, 211, 153, 0.28), transparent 18%, transparent 82%, rgba(52, 211, 153, 0.22)),
            linear-gradient(0deg, rgba(52, 211, 153, 0.20), transparent 18%, transparent 82%, rgba(52, 211, 153, 0.16));
        }

        .forest-card--seedling {
          border-color: rgba(74, 222, 128, 0.45) !important;
          box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.10), 0 0 10px rgba(74, 222, 128, 0.08);
        }

        .forest-card--mature {
          border-color: rgba(52, 211, 153, 0.70) !important;
          box-shadow: inset 0 0 0 1px rgba(110, 231, 183, 0.20), 0 0 14px rgba(16, 185, 129, 0.14);
          animation: forest-card-breathe 4.6s ease-in-out infinite;
        }

        .forest-card--mature::after {
          opacity: 0.54;
          background:
            linear-gradient(90deg, rgba(52, 211, 153, 0.34), transparent 20%, transparent 78%, rgba(52, 211, 153, 0.30)),
            linear-gradient(0deg, rgba(52, 211, 153, 0.26), transparent 18%, transparent 80%, rgba(52, 211, 153, 0.24)),
            linear-gradient(135deg, transparent 0 36%, rgba(110, 231, 183, 0.22) 36.5% 37.5%, transparent 38% 100%);
        }

        .forest-card.border-accent {
          border-color: rgb(245, 158, 11) !important;
        }

        .forest-card--fresh {
          animation: forest-card-arrive 0.9s ease-out;
        }

        .forest-card--growing {
          animation: forest-grow-card 0.82s ease-out;
        }

        .forest-card--growing::after {
          animation: forest-vine-grow 0.82s ease-out;
        }

        .glacier-card {
          border-color: rgba(125, 211, 252, 0.56) !important;
          box-shadow: inset 0 0 0 1px rgba(186, 230, 253, 0.14), 0 0 12px rgba(34, 211, 238, 0.10);
          animation: glacier-card-breathe 5.4s ease-in-out infinite;
          overflow: hidden;
        }

        .glacier-card.border-accent {
          border-color: rgb(245, 158, 11) !important;
        }

        .glacier-card::before,
        .glacier-card::after {
          content: "";
          position: absolute;
          inset: 6px;
          border-radius: 9px;
          pointer-events: none;
        }

        .glacier-card::before {
          opacity: 0.40;
          background:
            linear-gradient(120deg, transparent 0 30%, rgba(186, 230, 253, 0.28) 30.5% 31.5%, transparent 32% 100%),
            linear-gradient(35deg, transparent 0 64%, rgba(125, 211, 252, 0.22) 64.5% 65.5%, transparent 66% 100%),
            radial-gradient(circle at 82% 22%, rgba(224, 242, 254, 0.36) 0 1px, transparent 2px);
        }

        .glacier-card::after {
          opacity: 0.32;
          background:
            radial-gradient(circle at 9% 16%, rgba(224, 242, 254, 0.45) 0 1px, transparent 2px),
            radial-gradient(circle at 14% 86%, rgba(186, 230, 253, 0.30) 0 1px, transparent 2px),
            radial-gradient(circle at 88% 18%, rgba(224, 242, 254, 0.38) 0 1px, transparent 2px),
            radial-gradient(circle at 84% 82%, rgba(125, 211, 252, 0.28) 0 1px, transparent 2px),
            linear-gradient(90deg, rgba(186, 230, 253, 0.22), transparent 20%, transparent 80%, rgba(125, 211, 252, 0.20)),
            linear-gradient(0deg, rgba(186, 230, 253, 0.17), transparent 20%, transparent 80%, rgba(125, 211, 252, 0.14));
        }

        .glacier-card--echo-used {
          box-shadow: inset 0 0 0 1px rgba(224, 242, 254, 0.22), 0 0 14px rgba(14, 165, 233, 0.13);
        }

        .glacier-card--fresh {
          animation: glacier-card-arrive 0.82s ease-out, glacier-card-breathe 5.4s ease-in-out infinite 0.82s;
        }

        .glacier-echo-preview {
          overflow: hidden;
        }

        .glacier-echo-preview::before,
        .glacier-echo-modal::before,
        .glacier-echo-candidate::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          opacity: 0.22;
          background:
            linear-gradient(115deg, transparent 0 26%, rgba(186, 230, 253, 0.20) 26.5% 27.5%, transparent 28% 100%),
            radial-gradient(circle at 15% 22%, rgba(224, 242, 254, 0.24) 0 1px, transparent 2px),
            radial-gradient(circle at 84% 72%, rgba(125, 211, 252, 0.18) 0 1px, transparent 2px);
        }

        .glacier-echo-candidate {
          overflow: hidden;
        }

        .glacier-echo-candidate:hover {
          box-shadow: inset 0 0 0 1px rgba(224, 242, 254, 0.24), 0 0 18px rgba(34, 211, 238, 0.18);
        }

        .glacier-recycle-burst {
          overflow: hidden;
        }

        .glacier-recycle-burst::before,
        .glacier-recycle-burst::after {
          content: "✦";
          position: absolute;
          top: 15px;
          color: rgba(224, 242, 254, 0.70);
          font-size: 15px;
          filter: drop-shadow(0 0 7px rgba(125, 211, 252, 0.55));
          animation: glacier-shard-flow 0.82s ease-out;
        }

        .glacier-recycle-burst::before { left: 18px; }
        .glacier-recycle-burst::after { right: 18px; animation-direction: reverse; }

        .glacier-recycle-path {
          position: absolute;
          left: 18px;
          right: 18px;
          top: 18px;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(186, 230, 253, 0.68), transparent);
          box-shadow: 0 0 12px rgba(34, 211, 238, 0.28);
          animation: glacier-path-return 0.82s ease-out;
        }

        .forest-symbiosis-burst {
          overflow: hidden;
        }

        .forest-symbiosis-burst::before,
        .forest-symbiosis-burst::after {
          content: "•";
          position: absolute;
          top: 18px;
          color: rgba(110, 231, 183, 0.70);
          font-size: 18px;
          filter: drop-shadow(0 0 7px rgba(52, 211, 153, 0.55));
          animation: forest-particle-flow 0.95s ease-out;
        }

        .forest-symbiosis-burst::before { left: 18px; }
        .forest-symbiosis-burst::after { right: 18px; animation-direction: reverse; }

        .forest-symbiosis-link {
          position: absolute;
          left: 16px;
          right: 16px;
          top: 18px;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(110, 231, 183, 0.62), transparent);
          box-shadow: 0 0 12px rgba(52, 211, 153, 0.28);
        }

        @keyframes volcano-breathe {
          0%, 100% { box-shadow: 0 0 12px rgba(249, 115, 22, 0.08); }
          50% { box-shadow: 0 0 20px rgba(249, 115, 22, 0.18); }
        }

        @keyframes volcano-event-pulse {
          0%, 100% { transform: translateX(-50%) scale(1); }
          38% { transform: translateX(-50%) scale(1.035); box-shadow: 0 0 26px rgba(249, 115, 22, 0.28); }
          64% { transform: translateX(-50%) scale(0.99); }
        }

        @keyframes route-event-pulse {
          0%, 100% { transform: translateX(-50%) scale(1); }
          38% { transform: translateX(-50%) scale(1.025); }
          64% { transform: translateX(-50%) scale(0.995); }
        }

        @keyframes forest-breathe {
          0%, 100% { box-shadow: 0 0 12px rgba(16, 185, 129, 0.08); }
          50% { box-shadow: 0 0 20px rgba(16, 185, 129, 0.18); }
        }

        @keyframes forest-event-pulse {
          0%, 100% { transform: translateX(-50%) scale(1); }
          38% { transform: translateX(-50%) scale(1.035); box-shadow: 0 0 26px rgba(16, 185, 129, 0.28); }
          64% { transform: translateX(-50%) scale(0.99); }
        }

        @keyframes glacier-breathe {
          0%, 100% { box-shadow: 0 0 12px rgba(34, 211, 238, 0.08); }
          50% { box-shadow: 0 0 20px rgba(34, 211, 238, 0.16); }
        }

        @keyframes glacier-event-pulse {
          0%, 100% { transform: translateX(-50%) scale(1); }
          38% { transform: translateX(-50%) scale(1.035); box-shadow: 0 0 26px rgba(34, 211, 238, 0.24); }
          64% { transform: translateX(-50%) scale(0.99); }
        }

        @keyframes forest-card-breathe {
          0%, 100% { box-shadow: inset 0 0 0 1px rgba(110, 231, 183, 0.18), 0 0 12px rgba(16, 185, 129, 0.12); }
          50% { box-shadow: inset 0 0 0 1px rgba(110, 231, 183, 0.28), 0 0 18px rgba(16, 185, 129, 0.20); }
        }

        @keyframes forest-grow-card {
          0% { filter: brightness(1); box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.12), 0 0 8px rgba(16, 185, 129, 0.08); }
          36% { filter: brightness(1.16); box-shadow: inset 0 0 0 1px rgba(190, 242, 100, 0.36), 0 0 28px rgba(52, 211, 153, 0.32); }
          100% { filter: brightness(1); box-shadow: inset 0 0 0 1px rgba(110, 231, 183, 0.20), 0 0 14px rgba(16, 185, 129, 0.14); }
        }

        @keyframes forest-vine-grow {
          0% { clip-path: inset(0 50% 100% 50%); opacity: 0.10; }
          42% { clip-path: inset(0 22% 40% 22%); opacity: 0.45; }
          100% { clip-path: inset(0); opacity: 0.58; }
        }

        @keyframes forest-particle-flow {
          0% { transform: translateX(-24px) scale(0.7); opacity: 0; }
          35% { opacity: 1; }
          100% { transform: translateX(72px) scale(1); opacity: 0; }
        }

        @keyframes glacier-shard-flow {
          0% { transform: translateX(-18px) scale(0.65) rotate(0deg); opacity: 0; }
          34% { opacity: 1; }
          100% { transform: translateX(58px) scale(1) rotate(26deg); opacity: 0; }
        }

        @keyframes glacier-path-return {
          0% { transform: scaleX(0.1); opacity: 0; }
          32% { transform: scaleX(1); opacity: 1; }
          100% { transform: scaleX(0.88); opacity: 0; }
        }

        @keyframes lava-card-breathe {
          0%, 100% { box-shadow: inset 0 0 0 1px rgba(251, 146, 60, 0.14), 0 0 11px rgba(249, 115, 22, 0.10); }
          50% { box-shadow: inset 0 0 0 1px rgba(251, 146, 60, 0.25), 0 0 17px rgba(249, 115, 22, 0.18); }
        }

        @keyframes lava-card-arrive {
          0% { box-shadow: inset 0 0 0 1px rgba(251, 146, 60, 0.18), 0 0 8px rgba(249, 115, 22, 0.10); }
          42% { box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.58), 0 0 30px rgba(249, 115, 22, 0.36); }
          100% { box-shadow: inset 0 0 0 1px rgba(251, 146, 60, 0.18), 0 0 13px rgba(249, 115, 22, 0.12); }
        }

        @keyframes forest-card-arrive {
          0% { box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.14), 0 0 8px rgba(16, 185, 129, 0.10); }
          42% { box-shadow: inset 0 0 0 1px rgba(110, 231, 183, 0.58), 0 0 26px rgba(16, 185, 129, 0.30); }
          100% { box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.15), 0 0 12px rgba(16, 185, 129, 0.11); }
        }

        @keyframes glacier-card-breathe {
          0%, 100% { box-shadow: inset 0 0 0 1px rgba(186, 230, 253, 0.14), 0 0 11px rgba(34, 211, 238, 0.09); }
          50% { box-shadow: inset 0 0 0 1px rgba(224, 242, 254, 0.24), 0 0 17px rgba(34, 211, 238, 0.16); }
        }

        @keyframes glacier-card-arrive {
          0% { box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.14), 0 0 8px rgba(34, 211, 238, 0.08); }
          42% { box-shadow: inset 0 0 0 1px rgba(224, 242, 254, 0.52), 0 0 24px rgba(34, 211, 238, 0.26); }
          100% { box-shadow: inset 0 0 0 1px rgba(186, 230, 253, 0.14), 0 0 12px rgba(34, 211, 238, 0.10); }
        }
      `}</style>
    </div>
  );
}

function BattleCard({ card, faceDown }: { card: Card; faceDown?: boolean; key?: string }) {
  if (faceDown) {
    return (
      <motion.div 
        key={card.id + '_facedown'}
        initial={{ scale: 0.8, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="w-[90px] h-[120px] rounded-xl bg-gradient-to-br from-[#181920] to-[#111116] border border-[#3b82f6]/40 flex flex-col items-center justify-center relative shadow-2xl overflow-hidden select-none"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(59,130,246,0.05) 5px, rgba(59,130,246,0.05) 10px)' }}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500 opacity-60" />
        <div className="text-3xl mb-1 text-blue-400 select-none animate-pulse">🎴</div>
        <span className="text-[8px] font-mono font-black tracking-widest text-[#3b82f6]/95">敌方卡牌</span>
        <span className="text-[8px] font-mono font-black text-text-dim/60 mt-0.5">暗扣</span>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ scale: 0.8, opacity: 0, y: 10 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      className={`w-[90px] h-[120px] rounded-xl bg-surface border border-border flex flex-col items-center justify-center relative shadow-xl ${getCardBorderClass(card.type)} ${card.mutationType === 'VOLCANO' ? 'lava-card' : ''} ${card.mutationType === 'FOREST' ? `forest-card forest-card--${card.forestGrowthStage === 'MATURE' ? 'mature' : 'seedling'}` : ''} ${card.mutationType === 'GLACIER' ? `glacier-card ${card.glacierEchoUsed ? 'glacier-card--echo-used' : ''}` : ''}`}
    >
      <CardIcon type={card.type} className="relative z-10 text-3xl mb-1" />
      <span className="text-[9px] font-black tracking-widest opacity-40">
        {card.mutationType === 'VOLCANO'
          ? volcanoCardLabel(card.type)
          : card.mutationType === 'FOREST'
            ? `${forestIcon(card)} ${forestCardLabel(card.type)}`
            : card.mutationType === 'GLACIER'
              ? `❄️ ${glacierCardLabel(card.type)}`
            : cardLabel(card.type)}
      </span>
      {card.mutationType === 'FOREST' && (
        <span className="mt-0.5 text-[8px] font-black tracking-widest text-emerald-200/80">
          {forestStageLabel(card)}
        </span>
      )}
      {card.mutationType === 'VOLCANO' && (
        <div className="absolute top-1.5 right-1.5 text-[13px] leading-none drop-shadow-[0_0_6px_rgba(251,146,60,0.55)]" aria-hidden="true">
          🔥
        </div>
      )}
      {card.mutationType === 'FOREST' && (
        <div className="absolute top-1.5 right-1.5 text-[13px] leading-none drop-shadow-[0_0_6px_rgba(52,211,153,0.55)]" aria-hidden="true">
          {forestIcon(card)}
        </div>
      )}
      {card.mutationType === 'GLACIER' && (
        <div className="absolute top-1.5 right-1.5 text-[13px] leading-none drop-shadow-[0_0_6px_rgba(125,211,252,0.55)]" aria-hidden="true">
          ❄️
        </div>
      )}
      {card.mutationType === 'GLACIER' && card.glacierEchoUsed && (
        <div className="absolute bottom-1.5 right-1.5 rounded border border-cyan-200/30 bg-[#06121a]/85 px-1.5 py-0.5 text-[7px] font-black tracking-wider text-cyan-50/80 shadow-[0_0_8px_rgba(125,211,252,0.15)] pointer-events-none">
          ❄️ 1 / 1
        </div>
      )}
    </motion.div>
  );
}
