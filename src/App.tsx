import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, ArrowDown, ArrowUpDown, Sword, RotateCcw, User, Cpu, ChevronRight, Info, Lock, Volume2, VolumeX, Settings } from 'lucide-react';
import { Card, CardType, GameState, WIN_MAP } from './types';
import { zhCN } from './locales/zh-CN';
import { allocateLimitedSharedDeckDraws, DrawQueueItem } from './game/sharedDeck';
import {
  ACTIVE_ENVIRONMENT_CONFIG,
  MUTATION_INTERVAL_ROUNDS,
  MUTATION_LIMIT,
  VOLCANO_ENVIRONMENT_CONFIG,
  advanceForestGrowth,
  applyMutationToCard,
  calculateForestRecovery,
  calculateVolcanoDamage,
  canTriggerMutation,
  countAllMutatedCards,
  getForestMutationCandidates,
  getGlacierMutationCandidates,
  removeMutationFromCard,
  selectAiMutationCandidate,
} from './game/environment';

const INITIAL_HP = 10;
const MAX_HAND = 4;
const CARD_TYPES: CardType[] = ['ROCK', 'PAPER', 'SCISSORS'];
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
  for (let i = 0; i < 10; i++) {
    pool.push(createCard('ROCK'));
    pool.push(createCard('PAPER'));
    pool.push(createCard('SCISSORS'));
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
const isGlacierEnvironment = ACTIVE_ENVIRONMENT_CONFIG.id === 'GLACIER';
const activeMutationType = ACTIVE_ENVIRONMENT_CONFIG.id;
const activeMutationLabel = isGlacierEnvironment ? '冰川' : '森林';
const activeMutationCardLabel = (type: CardType) =>
  isGlacierEnvironment ? glacierCardLabel(type) : forestCardLabel(type);
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
    playerHand: deckOnMount.slice(0, 4),
    aiHand: deckOnMount.slice(4, 8),
    playerRole: 'HOME',
    aiRole: 'GUEST',
    phase: 'PLAYER_ATTACK',
    homePlayed: [],
    guestPlayed: [],
    lastAction: zhCN.logs.battleInitialized,
    winner: null,
    drawPile: deckOnMount.slice(8),
    playerDiscardPile: [],
    aiDiscardPile: [],
  }));

  const stateRef = useRef<GameState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const settlementTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const continueAfterMutationRef = useRef<(() => void) | null>(null);
  const completedClashCountRef = useRef(0);
  const clearSettlementTimers = useCallback(() => {
    settlementTimersRef.current.forEach(timer => clearTimeout(timer));
    settlementTimersRef.current = [];
  }, []);
  const scheduleSettlementTimer = useCallback((fn: () => void, delay: number) => {
    const timer = setTimeout(fn, delay);
    settlementTimersRef.current.push(timer);
    return timer;
  }, []);

  useEffect(() => () => {
    clearSettlementTimers();
  }, [clearSettlementTimers]);

  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [settlementSubPhase, setSettlementSubPhase] = useState<'resolving' | 'move-to-discard' | 'replenishing' | 'replenish-complete' | 'round-end' | null>(null);
  const [logs, setLogs] = useState<string[]>([zhCN.logs.battleInitialized]);
  
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
  const [glacierRecycleFeedback, setGlacierRecycleFeedback] = useState<{
    targets: Array<'PLAYER' | 'AI'>;
    token: number;
  } | null>(null);
  
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
    setTimeout(() => {
      setSharedDeckScale(false);
    }, 250);
    setTimeout(() => {
      setSharedDeckPrompt(null);
      setSharedDeckSubPrompt(null);
      setSharedDeckChangeAmount(null);
      setSharedDeckTransit(null);
    }, 2000);
  }, []);

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
    setTimeout(() => {
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

  const showShortNotice = (msg: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setShortNotice(msg);
    noticeTimerRef.current = setTimeout(() => {
      setShortNotice(null);
    }, 2200);
  };
  const logContainerRef = useRef<HTMLDivElement>(null);

  const [screen, setScreen] = useState<'HOME' | 'BATTLE'>('HOME');
  const [selectedProtocol, setSelectedProtocol] = useState<'QUICK' | 'TRAINING' | 'CHALLENGE' | null>(null);
  const [homeLogs, setHomeLogs] = useState<string[]>([
    zhCN.logs.battleEngineOnline,
    zhCN.logs.selectProtocol,
  ]);
  const [isMuted, setIsMuted] = useState(false);
  const homeLogContainerRef = useRef<HTMLDivElement>(null);

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
  }, [logs]);

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

    // Player draws up to Math.min(2, MAX_HAND - current hand size)
    const pDrawnCards: Card[] = [];
    const pDrawCount = Math.min(2, Math.max(0, MAX_HAND - newPHand.length));

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

    // AI draws up to Math.min(2, MAX_HAND - current hand size)
    const aDrawnCards: Card[] = [];
    const aDrawCount = Math.min(2, Math.max(0, MAX_HAND - newAHand.length));

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
  }, []);

  const resetGame = () => {
    clearSettlementTimers();
    const newDeck = createDeck();
    const nextState: GameState = {
      playerHP: INITIAL_HP,
      aiHP: INITIAL_HP,
      playerHand: newDeck.slice(0, 4),
      aiHand: newDeck.slice(4, 8),
      playerRole: 'HOME',
      aiRole: 'GUEST',
      phase: 'PLAYER_ATTACK',
      homePlayed: [],
      guestPlayed: [],
      lastAction: zhCN.logs.reset,
      winner: null,
      drawPile: newDeck.slice(8),
      playerDiscardPile: [],
      aiDiscardPile: [],
    };
    stateRef.current = nextState;
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
    setGlacierRecycleFeedback(null);
    continueAfterMutationRef.current = null;
    setPlayerDiscardPrompt(null);
    setAiDiscardPrompt(null);
    setSharedDeckPrompt(null);
    setSharedDeckSubPrompt(null);
    setSharedDeckChangeAmount(null);
    setSharedDeckTransit(null);
    setSharedDeckScale(false);
    setActiveAnims([]);
  };

  const returnToLobby = () => {
    resetGame();
    setScreen('HOME');
    setSelectedProtocol(null);
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
            ? (isGlacierEnvironment ? glacierCardLabel(selectedPlayerCard.type) : `${forestCardLabel(selectedPlayerCard.type)}·幼苗`)
            : `${activeMutationLabel}异变牌`
        }”`);
      }

      let aiHand = prev.aiHand;
      if (countAllMutatedCards(aiHand) >= MUTATION_LIMIT) {
        logsToAppend.push('[环境事件] 对手异变牌已达上限，本次感染跳过');
      } else {
        const aiCandidates = isGlacierEnvironment
          ? getGlacierMutationCandidates(aiHand)
          : getForestMutationCandidates(aiHand);
        const selectedAiCard = selectAiMutationCandidate(aiCandidates, aiHand);
        if (selectedAiCard) {
          aiHand = aiHand.map(applyMutationToCard(selectedAiCard.id, activeMutationType, completedClashCountRef.current));
          logsToAppend.push(`[环境事件] 对手获得 1 张${activeMutationLabel}异变牌`);
          setMutationAnimation({ side: 'AI', token: Date.now() });
          setAiMutationCountPulse(true);
          showMutationPhaseNotice(`对手完成${activeMutationLabel}感染`, 700);
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
      scheduleSettlementTimer(continueTurn, 300);
    }
  }, [scheduleSettlementTimer, showMutationPhaseNotice]);

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
      resultLogs.push('[冰川回收] 冰川牌失去异变属性，恢复为普通牌');
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
    const playerDamage = playerRoleAtClash === 'HOME' ? hDamage : gDamage;
    const aiDamage = aiRoleAtClash === 'HOME' ? hDamage : gDamage;
    const playerBaseDamage = playerRoleAtClash === 'HOME' ? baseDamageToHome : baseDamageToGuest;
    const aiBaseDamage = aiRoleAtClash === 'HOME' ? baseDamageToHome : baseDamageToGuest;
    const playerVolcanoDamage = playerRoleAtClash === 'HOME' ? volcanoDamageToHome : volcanoDamageToGuest;
    const aiVolcanoDamage = aiRoleAtClash === 'HOME' ? volcanoDamageToHome : volcanoDamageToGuest;
    const playerResonanceDamage = playerRoleAtClash === 'HOME' ? resonanceDamageToHome : resonanceDamageToGuest;
    const aiResonanceDamage = aiRoleAtClash === 'HOME' ? resonanceDamageToHome : resonanceDamageToGuest;
    const homeInitialHP = playerRoleAtClash === 'HOME' ? clashSnapshot.playerHP : clashSnapshot.aiHP;
    const guestInitialHP = playerRoleAtClash === 'GUEST' ? clashSnapshot.playerHP : clashSnapshot.aiHP;
    const homeHpAfterDamage = Math.max(0, homeInitialHP - hDamage);
    const guestHpAfterDamage = Math.max(0, guestInitialHP - gDamage);
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
      maxHp: INITIAL_HP,
    });
    const guestForestRecovery = calculateForestRecovery({
      successfulMatureForestHits: guestMatureForestHits,
      playedMatureForestCards: symbiosisOwner === 'GUEST'
        ? guestPlayedMatureForestCards
        : Math.min(guestPlayedMatureForestCards, 1),
      currentHp: guestHpAfterDamage,
      maxHp: INITIAL_HP,
    });
    const playerForestRecovery = playerRoleAtClash === 'HOME'
      ? homeForestRecovery.finalRecovery
      : guestForestRecovery.finalRecovery;
    const aiForestRecovery = aiRoleAtClash === 'HOME'
      ? homeForestRecovery.finalRecovery
      : guestForestRecovery.finalRecovery;
    const playerHpAfterDamage = Math.max(0, clashSnapshot.playerHP - playerDamage);
    const aiHpAfterDamage = Math.max(0, clashSnapshot.aiHP - aiDamage);
    const resolvedPlayerHP = Math.min(INITIAL_HP, playerHpAfterDamage + playerForestRecovery);
    const resolvedAiHP = Math.min(INITIAL_HP, aiHpAfterDamage + aiForestRecovery);
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
    ) => {
      if (totalDamage <= 0) return;
      resultLogs.push(`[伤害] 基础伤害：${baseDamage}`);
      const volcanoLog = buildVolcanoDamageLog(damagingCards, volcanoBonus);
      if (volcanoLog) resultLogs.push(volcanoLog);
      if (resonanceBonus > 0) resultLogs.push(`[羁绊] 触发“灼烧共鸣”：+${VOLCANO_ENVIRONMENT_CONFIG.resonanceBonusDamage}`);
      resultLogs.push(`[结算] 最终伤害：${totalDamage}`);
      if (resonanceBonus > 0) {
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
    if (aiDamage > 0) {
      appendDamageBreakdownLogs(aiBaseDamage, aiVolcanoDamage, aiResonanceDamage, aiDamage, aiRoleAtClash === 'HOME' ? guestDamagingCards : finalHomeAttack);
      resultLogs.push(zhCN.logs.aiDamage(aiDamage));
    }
    if (playerDamage > 0) {
      appendDamageBreakdownLogs(playerBaseDamage, playerVolcanoDamage, playerResonanceDamage, playerDamage, playerRoleAtClash === 'HOME' ? guestDamagingCards : finalHomeAttack);
      resultLogs.push(zhCN.logs.playerDamage(playerDamage));
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
      setState(prev => ({
        ...prev,
        playerHP: resolvedPlayerHP,
        aiHP: resolvedAiHP,
      }));
    }, 150);

    const finishTurn = () => {
      setSettlementSubPhase('round-end');
      scheduleSettlementTimer(() => {
        setState(prev => {
          let winner: 'PLAYER' | 'AI' | 'DRAW' | null = null;
          let extraActionLogs = '';

          if (prev.playerHP <= 0 && prev.aiHP <= 0) winner = 'DRAW';
          else if (prev.aiHP <= 0) winner = 'PLAYER';
          else if (prev.playerHP <= 0) winner = 'AI';

          if (!winner && prev.drawPile.length === 0) {
            const playerHandCount = prev.playerHand.length;
            const aiHandCount = prev.aiHand.length;
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

          const nextPlayerRole = prev.playerRole === 'HOME' ? 'GUEST' : 'HOME';
          return {
            ...prev,
            playerRole: nextPlayerRole,
            aiRole: nextPlayerRole === 'HOME' ? 'GUEST' : 'HOME',
            phase: winner ? 'GAME_OVER' : (nextPlayerRole === 'HOME' ? 'PLAYER_ATTACK' : 'AI_ATTACK'),
            homePlayed: [],
            guestPlayed: [],
            winner,
            lastAction: prev.lastAction + extraActionLogs,
          };
        });
        setIsProcessing(false);
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

        const nextMutationCount = Math.min(
          MUTATION_INTERVAL_ROUNDS,
          completedClashesSinceMutation + 1 + forestMutationCountdownReduction
        );

        if (latest.drawPile.length <= 0) {
          setLogs(prev => [...prev, '[环境事件] 公共牌库已耗尽，感染阶段关闭']);
          scheduleSettlementTimer(finishTurn, 350);
          return;
        }

        if (!canTriggerMutation(latest.drawPile.length, nextMutationCount)) {
          setCompletedClashesSinceMutation(nextMutationCount);
          const roundsRemaining = MUTATION_INTERVAL_ROUNDS - nextMutationCount;
          if (roundsRemaining === 1) {
            setLogs(prev => [...prev, `[环境事件] ${activeMutationLabel}感染将在 1 轮后触发`]);
          }
          scheduleSettlementTimer(finishTurn, 350);
          return;
        }

        setCompletedClashesSinceMutation(0);
        setLogs(prev => [...prev, `[环境事件] ${activeMutationLabel}感染已触发`]);
        continueAfterMutationRef.current = finishTurn;
        showMutationPhaseNotice(`${activeMutationLabel}感染阶段`, 700);
        pulseMutationEvent();

        if (countAllMutatedCards(latest.playerHand) >= MUTATION_LIMIT) {
          setLogs(prev => [...prev, '[环境事件] 我方异变牌已达上限，本次感染跳过']);
          finishMutationStage();
          return;
        }

        const playerCandidates = isGlacierEnvironment
          ? getGlacierMutationCandidates(latest.playerHand)
          : getForestMutationCandidates(latest.playerHand);
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
      setState(prev => {
        const drawCount = Math.min(action.count, prev.drawPile.length);
        if (drawCount <= 0) return prev;

        const beforeDeckCount = action.beforeCount;
        const drawnCards = prev.drawPile.slice(0, drawCount);
        const nextDrawPile = prev.drawPile.slice(drawCount);
        const afterDeckCount = action.afterCount;

        if (action.user === 'PLAYER') {
          drawnCards.forEach((card, cardIndex) => {
            scheduleSettlementTimer(() => {
              addAnimation('DRAW_PLAYER', 110, 620, 420 + (prev.playerHand.length + cardIndex) * 60, 648, card.type);
            }, cardIndex * 100);
          });
          triggerDeckFeedback(`我方补牌 +${drawCount}`, zhCN.logs.playerDraw(drawCount), `-${drawCount}`, `${beforeDeckCount} → ${afterDeckCount}`);
          setLogs(logPrev => [
            ...logPrev,
            zhCN.logs.playerDraw(drawCount),
            zhCN.logs.sharedDeckChange(beforeDeckCount, afterDeckCount),
          ]);
          return {
            ...prev,
            playerHand: [...prev.playerHand, ...drawnCards],
            drawPile: nextDrawPile,
          };
        }

        drawnCards.forEach((_, cardIndex) => {
          scheduleSettlementTimer(() => {
            addAnimation('DRAW_AI', 110, 620, 880 + (prev.aiHand.length + cardIndex) * 40, 60, undefined);
          }, cardIndex * 100);
        });
        triggerDeckFeedback(`敌方补牌 +${drawCount}`, zhCN.logs.aiDraw(drawCount), `-${drawCount}`, `${beforeDeckCount} → ${afterDeckCount}`);
        setLogs(logPrev => [
          ...logPrev,
          zhCN.logs.aiDraw(drawCount),
          zhCN.logs.sharedDeckChange(beforeDeckCount, afterDeckCount),
        ]);
        return {
          ...prev,
          aiHand: [...prev.aiHand, ...drawnCards],
          drawPile: nextDrawPile,
        };
      });

      scheduleSettlementTimer(() => executeDrawQueue(queue, index + 1), 650);
    };

    const beginReplenishment = () => {
      setSettlementSubPhase('replenishing');
      const latest = stateRef.current;
      const playerNeed = Math.min(2, Math.max(0, MAX_HAND - latest.playerHand.length));
      const aiNeed = Math.min(2, Math.max(0, MAX_HAND - latest.aiHand.length));
      const deckCount = latest.drawPile.length;
      const totalNeed = playerNeed + aiNeed;

      if (deckCount <= 0) {
        setLogs(prev => [
          ...prev,
          zhCN.logs.finalClashNoReplenish,
          '[环境事件] 公共牌库已耗尽，感染阶段关闭',
          zhCN.logs.playerHandRemaining(latest.playerHand.length),
          zhCN.logs.aiHandRemaining(latest.aiHand.length),
        ]);
        scheduleSettlementTimer(finishTurn, 350);
        return;
      }

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
        queue = allocateLimitedSharedDeckDraws({
          deckCount,
          playerNeed,
          aiNeed,
          nextHomeSide: nextPlayerRole === 'HOME' ? 'PLAYER' : 'AI',
        });
        setLogs(prev => [...prev, zhCN.logs.limitedSharedDeck]);
      }
      let nextDeckCount = deckCount;
      const queueWithSnapshots = queue.map(action => {
        const drawCount = Math.min(action.count, nextDeckCount);
        const snapshot = {
          ...action,
          beforeCount: nextDeckCount,
          afterCount: nextDeckCount - drawCount,
        };
        nextDeckCount = snapshot.afterCount;
        return snapshot;
      });
      executeDrawQueue(queueWithSnapshots);
    };

    const startDiscardSequence = () => {
      if (resolvedPlayerHP <= 0 || resolvedAiHP <= 0) {
        setState(prev => ({
          ...prev,
          playerHP: resolvedPlayerHP,
          aiHP: resolvedAiHP,
          phase: 'GAME_OVER',
          homePlayed: [],
          guestPlayed: [],
          winner: resolvedPlayerHP <= 0 && resolvedAiHP <= 0 ? 'DRAW' : resolvedAiHP <= 0 ? 'PLAYER' : 'AI',
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
      const playerReclaimedCards = glacierReclaims
        .filter(reclaim => ownerForSide(reclaim.side) === 'PLAYER')
        .map(reclaim => removeMutationFromCard(reclaim.card));
      const aiReclaimedCards = glacierReclaims
        .filter(reclaim => ownerForSide(reclaim.side) === 'AI')
        .map(reclaim => removeMutationFromCard(reclaim.card));
      const longestDiscardQueue = Math.max(playerDiscardCards.length, aiDiscardCards.length);
      const discardAnimationDuration = longestDiscardQueue > 0
        ? (longestDiscardQueue - 1) * 120 + 650
        : 250;

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
      const recycleTargets = [
        ...(playerReclaimedCards.length > 0 ? ['PLAYER' as const] : []),
        ...(aiReclaimedCards.length > 0 ? ['AI' as const] : []),
      ];
      if (recycleTargets.length > 0) {
        setGlacierRecycleFeedback({ targets: recycleTargets, token: Date.now() });
        scheduleSettlementTimer(() => setGlacierRecycleFeedback(null), 850);
      }

      setState(prev => {
        const nextState = {
          ...prev,
          playerHand: [...prev.playerHand, ...playerReclaimedCards],
          aiHand: [...prev.aiHand, ...aiReclaimedCards],
          playerDiscardPile: [...prev.playerDiscardPile, ...playerDiscardCards],
          aiDiscardPile: [...prev.aiDiscardPile, ...aiDiscardCards],
        };
        stateRef.current = nextState;
        return nextState;
      });
      scheduleSettlementTimer(beginReplenishment, discardAnimationDuration);
    };

    scheduleSettlementTimer(() => {
      setClashResult(null);
      scheduleSettlementTimer(startDiscardSequence, 250);
    }, 850);

    setSelectedCards([]);
  }, [addAnimation, clearSettlementTimers, completedClashCount, completedClashesSinceMutation, finishMutationStage, pulseMutationEvent, scheduleSettlementTimer, showMutationPhaseNotice, triggerDeckFeedback]);

  // --- AI LOGIC ---
  const executeAiMove = useCallback(() => {
    if (state.winner || isProcessing) return;

    setTimeout(() => {
      let aiRerolledThisTime = false;
      let aiDiscardedCard: Card | null = null;
      let aiDrawnCard: Card | null = null;

      setState(prev => {
        let hand = [...prev.aiHand];
        let tempDraw = [...prev.drawPile];
        let tempAiDiscard = [...prev.aiDiscardPile];
        let aiRerolledText = "";

        // Should AI reroll? Only if there are cards in the public draw pile!
        if (!aiHasRerolledThisTurn && hand.length > 0 && tempDraw.length > 0 && Math.random() < 0.3) {
          aiRerolledThisTime = true;
          const discardIndex = Math.floor(Math.random() * hand.length);
          aiDiscardedCard = hand[discardIndex];
          hand.splice(discardIndex, 1);
          tempAiDiscard.push(aiDiscardedCard);

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
            const maxCount = Math.min(typeGroups[randomType].length, 3);
            const count = Math.floor(Math.random() * maxCount) + 1; // 1 to 3
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
            aiDiscardPile: tempAiDiscard,
          };
        } 
        
        if (prev.phase === 'AI_DEFEND') {
          // AI as Guest: 0 to Home's count
          const maxTake = prev.homePlayed.length;
          const takeCount = Math.floor(Math.random() * (maxTake + 1));
          
          let selectedToPlay: Card[] = [];
          if (maxTake > 0 && hand.length > 0) {
            const homeType = prev.homePlayed[0].type;
            const counterType = (Object.entries(WIN_MAP).find(([_, val]) => val === homeType)?.[0] || 'ROCK') as CardType;
            
            const counters = hand.filter(c => c.type === counterType);
            const others = hand.filter(c => c.type !== counterType);
            
            selectedToPlay = [...counters.slice(0, takeCount)];
            if (selectedToPlay.length < takeCount) {
              selectedToPlay = [...selectedToPlay, ...others.slice(0, takeCount - selectedToPlay.length)];
            }
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
            aiDiscardPile: tempAiDiscard,
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
          setTimeout(() => {
            setAiDiscardPrompt(null);
          }, 1500);
        }
        if (aiDrawnCard) {
          setTimeout(() => {
            // AI draw: fly from shared deck (110, 620) to AI hand area (880, 60) face-down
            addAnimation('DRAW_AI', 110, 620, 880, 60, undefined);
            triggerDeckFeedback('敌方重抽', zhCN.logs.aiReroll, '-1');
          }, 250);
        }
      }
    }, 1200);
  }, [state.winner, isProcessing, aiHasRerolledThisTurn, addAnimation]);

  // Effect to separate AI execution and Settlement triggering
  useEffect(() => {
    if (state.phase === 'AI_ATTACK' || state.phase === 'AI_DEFEND') {
      executeAiMove();
    }
  }, [state.phase, executeAiMove]);

  useEffect(() => {
    if (state.phase === 'REVEAL') {
      const timer = setTimeout(() => {
        setState(prev => ({
          ...prev,
          phase: 'RESOLVE',
        }));
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [state.phase]);

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
    setTimeout(() => {
      setPlayerDiscardPrompt(null);
    }, 1500);

    // Stagger the drawing phase
    setTimeout(() => {
      if (tempDraw.length === 0) {
        // Truly empty
        setState(prev => ({
          ...prev,
          playerHand: prev.playerHand.filter(c => c.id !== rerollSelectedCardId),
          playerDiscardPile: [...prev.playerDiscardPile, cardToDiscard],
          lastAction: `[系统] 牌库为空，本次弃牌无法补入新牌`,
        }));
        setDrawWarningPopUp(true);
      } else {
        // Draw 1 card
        const drawnCard = tempDraw.shift()!;
        // Draw animation: from shared deck (110, 620) to player's hand (500, 640)
        addAnimation('DRAW_PLAYER', 110, 620, 500, 640, drawnCard.type);

        triggerDeckFeedback('我方重抽', zhCN.logs.playerReroll, '-1');
        
        setState(prev => {
          const nextHand = prev.playerHand.filter(c => c.id !== rerollSelectedCardId);
          nextHand.push(drawnCard);
          
          return {
            ...prev,
            playerHand: nextHand,
            drawPile: tempDraw,
            playerDiscardPile: tempPlayerDiscard,
            lastAction: `${zhCN.logs.playerReroll}\n${zhCN.logs.sharedDeckChange(prev.drawPile.length, tempDraw.length)}`,
          };
        });
      }
    }, 300);

    setPlayerHasRerolledThisTurn(true);
    setIsRerollMode(false);
    setRerollSelectedCardId(null);
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

  const isPlayerTurnState = (state.phase === 'PLAYER_ATTACK' || state.phase === 'PLAYER_DEFEND') && !isProcessing;
  const playerMutationCount = countAllMutatedCards(state.playerHand);
  const aiMutationCount = countAllMutatedCards(state.aiHand);
  const selectedVolcanoCards = state.playerHand.filter(card =>
    selectedCards.includes(card.id) && card.mutationType === 'VOLCANO'
  );
  const selectedMatureForestCards = state.playerHand.filter(card =>
    selectedCards.includes(card.id) && isMatureForestCard(card)
  );
  const showResonancePreview = selectedVolcanoCards.length >= 2 && !isRerollMode && isPlayerTurnState;
  const showSymbiosisPreview = selectedMatureForestCards.length >= 2 && !isRerollMode && isPlayerTurnState;
  const mutationRoundsRemaining = state.drawPile.length === 0
    ? 0
    : MUTATION_INTERVAL_ROUNDS - completedClashesSinceMutation;
  const isMutationImminent = state.phase === 'RESOLVE'
    && completedClashesSinceMutation === MUTATION_INTERVAL_ROUNDS - 1
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
      titleEng = ACTIVE_ENVIRONMENT_CONFIG.name;
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
                  <span className="block text-[10px] text-text-dim/50 mt-1">{zhCN.home.quickDescription}</span>
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
                    resetGame();
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
                setHomeLogs(prev => [
                  ...prev,
                  zhCN.logs.protocolUnavailable,
                ]);
              }}
              className="w-[275px] p-5 rounded-xl border border-fuchsia-950/45 bg-[#130c16] flex flex-col justify-between transition-all duration-300 opacity-75 hover:border-fuchsia-750/50 group select-none cursor-pointer"
            >
              <div>
                <div className="flex items-center justify-between mb-3 text-[9px] font-bold font-mono">
                  <span className="text-fuchsia-400/80 bg-fuchsia-950/55 border border-fuchsia-900/40 px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center">
                    <Lock className="w-2.5 h-2.5 mr-1 text-fuchsia-400/70" />
                    {zhCN.home.locked}
                  </span>
                  <span className="text-fuchsia-500/50 font-mono font-bold">协议 03</span>
                </div>
                <h3 className="text-[15px] font-black tracking-wide text-fuchsia-400/90 uppercase transition-colors">
                  {zhCN.home.challenge}
                </h3>
                <p className="text-[11px] font-medium text-text-dim/70 mt-1 mb-5 leading-normal">
                  {zhCN.home.challenge}
                  <span className="block text-[10px] text-fuchsia-500/45 mt-1">{zhCN.home.challengeDescription}</span>
                </p>
              </div>

              <button
                disabled
                className="w-full py-2.5 rounded-lg text-xs font-black tracking-widest uppercase bg-fuchsia-950/20 text-fuchsia-400/35 border border-fuchsia-900/30 cursor-not-allowed"
              >
                {zhCN.home.startBattle}
              </button>
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
    <div className="w-[1024px] h-[768px] mx-auto bg-bg text-text-main flex flex-col font-sans border border-border overflow-hidden relative shadow-2xl">
      {/* Header */}
      <div className="h-20 px-10 flex items-center justify-between border-b border-border bg-surface/80 backdrop-blur-md z-20">
        <div className={`relative w-[300px] p-1 rounded-lg transition-all duration-350 border border-transparent ${playerHPShake ? 'animate-hp-shake' : ''} ${burnFeedback?.targets.includes('PLAYER') ? 'burn-hp-feedback animate-burn-hp-shake' : ''} ${forestRecoveryFeedback?.recoveryByTarget.PLAYER ? 'forest-recovery-hp-feedback' : ''} ${playerHPFlash ? 'bg-red-500/10 border-red-500/35 shadow-[0_0_15px_rgba(239,68,68,0.15)] bg-opacity-30' : ''}`}>
          <div className="text-[12px] mb-1 text-text-dim tracking-wider">玩家</div>
          <div className="w-full h-3 bg-[#222] rounded-full overflow-hidden border border-[#333]">
            <motion.div 
              initial={false}
              animate={{ width: `${(state.playerHP / INITIAL_HP) * 100}%` }}
              className="h-full hp-bar-gradient-player"
            />
          </div>
          <div className="flex justify-between mt-1 items-center font-mono opacity-80">
            <span className="text-sm">
              {state.playerHP}/{INITIAL_HP}
              {forestRecoveryFeedback?.recoveryByTarget.PLAYER ? (
                <span className="ml-2 text-[11px] font-black text-emerald-300 drop-shadow-[0_0_7px_rgba(52,211,153,0.55)]">+{forestRecoveryFeedback.recoveryByTarget.PLAYER}</span>
              ) : null}
            </span>
            <span className="text-[10px]">生命</span>
          </div>
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
        </div>

        <div className={`relative w-[300px] text-right p-1 rounded-lg transition-all duration-350 border border-transparent ${aiHPShake ? 'animate-hp-shake' : ''} ${burnFeedback?.targets.includes('AI') ? 'burn-hp-feedback animate-burn-hp-shake' : ''} ${forestRecoveryFeedback?.recoveryByTarget.AI ? 'forest-recovery-hp-feedback' : ''} ${aiHPFlash ? 'bg-red-500/10 border-red-500/35 shadow-[0_0_15px_rgba(239,68,68,0.15)] bg-opacity-30' : ''}`}>
          <div className="text-[12px] mb-1 text-text-dim tracking-wider">对手</div>
          <div className="w-full h-3 bg-[#222] rounded-full overflow-hidden border border-[#333]">
            <motion.div 
              initial={false}
              animate={{ width: `${(state.aiHP / INITIAL_HP) * 100}%` }}
              className="h-full hp-bar-gradient-ai"
            />
          </div>
          <div className="flex justify-between mt-1 items-center font-mono opacity-80">
            <span className="text-sm">
              {state.aiHP}/{INITIAL_HP}
              {forestRecoveryFeedback?.recoveryByTarget.AI ? (
                <span className="ml-2 text-[11px] font-black text-emerald-300 drop-shadow-[0_0_7px_rgba(52,211,153,0.55)]">+{forestRecoveryFeedback.recoveryByTarget.AI}</span>
              ) : null}
            </span>
            <span className="text-[10px]">生命</span>
          </div>
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

      {/* Main Arena */}
      <div className="flex-1 flex flex-col items-center justify-center gap-10 relative">

        {/* AI Cards Back (Visual only) */}
        <div className="absolute top-6 right-10 flex gap-2 min-h-[56px] items-center">
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
        <div className="absolute top-[18px] right-[220px] flex items-center justify-end select-none font-mono relative">
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
          {state.winner ? (
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
                  onClick={resetGame}
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
            <div key="battle" className="flex flex-col gap-6 items-center relative">
              <div className={`${isGlacierEnvironment ? 'glacier-event-panel' : 'forest-event-panel'} absolute -top-16 left-1/2 -translate-x-1/2 w-[250px] rounded-md border ${isGlacierEnvironment ? 'border-cyan-300/30 bg-[#06121a]/88 shadow-[0_0_16px_rgba(34,211,238,0.12),inset_0_0_18px_rgba(34,211,238,0.04)]' : 'border-emerald-500/30 bg-[#06130e]/88 shadow-[0_0_16px_rgba(16,185,129,0.12),inset_0_0_18px_rgba(16,185,129,0.04)]'} px-3 py-2 text-center font-mono ${mutationEventPulse ? (isGlacierEnvironment ? 'glacier-event-panel--pulse' : 'forest-event-panel--pulse') : ''}`}>
                <span className={`${isGlacierEnvironment ? 'glacier-event-crystal' : 'forest-event-leaf'} forest-event-leaf--left`} aria-hidden="true">
                  {isGlacierEnvironment ? '✦' : '⌁'}
                </span>
                <span className={`${isGlacierEnvironment ? 'glacier-event-crystal' : 'forest-event-leaf'} forest-event-leaf--right`} aria-hidden="true">
                  {isGlacierEnvironment ? '✦' : '⌁'}
                </span>
                <div className={`relative z-10 flex items-center justify-center gap-1.5 text-[11px] font-black tracking-widest ${isGlacierEnvironment ? 'text-cyan-100' : 'text-emerald-200'}`}>
                  <span className="text-[12px]" aria-hidden="true">{ACTIVE_ENVIRONMENT_CONFIG.icon}</span>
                  <span>{ACTIVE_ENVIRONMENT_CONFIG.name}</span>
                </div>
                <div className={`relative z-10 text-[10px] font-semibold mt-0.5 ${isGlacierEnvironment ? 'text-cyan-50/76' : 'text-emerald-100/76'}`}>
                  {mutationEventStatus.startsWith('下一次感染：') ? (
                    <>
                      下一次感染：
                      <span className={`mx-0.5 text-[12px] font-black drop-shadow-[0_0_7px_rgba(52,211,153,0.35)] ${isGlacierEnvironment ? 'text-cyan-100' : 'text-emerald-200'}`}>
                        {mutationRoundsRemaining}
                      </span>
                      轮后
                    </>
                  ) : mutationEventStatus}
                </div>
              </div>

              {/* AI Battle Slot */}
              <div className="flex gap-4 min-h-[140px] items-center">
                <div className={`absolute -right-32 top-8 min-w-[120px] text-[10px] font-mono font-bold ${isGlacierEnvironment ? 'text-cyan-100/80' : 'text-emerald-200/80'} tracking-wider transition-transform duration-200 ${aiMutationCountPulse ? 'scale-110' : 'scale-100'}`}>
                  <div>{ACTIVE_ENVIRONMENT_CONFIG.icon} 对手手牌异变：{aiMutationCount} / {MUTATION_LIMIT}</div>
                  {aiMutationCount >= MUTATION_LIMIT && (
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
        <div 
          ref={logContainerRef}
          className="absolute left-10 bottom-10 w-[280px] h-[135px] bg-[#0a0a0b]/80 backdrop-blur-md rounded-xl p-3.5 text-[12px] overflow-y-auto border border-border custom-scrollbar flex flex-col gap-1.5 scroll-smooth z-30"
        >
          <div className="font-bold text-accent text-[10px] tracking-widest sticky top-0 bg-[#0a0a0b]/10 backdrop-blur-[2px] pb-1 border-b border-border/40 z-10">战斗日志</div>
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
              const isGlacierLog = log.includes('冰川') || log.includes('[冰川回收]');
              const isAiMutation = isEnvironment && log.includes('对手获得');
              const isMutationLimit = isEnvironment && log.includes('上限');
              const isMutationClosed = isEnvironment && log.includes('耗尽');
              const isVolcanoDamage = log.includes('[火山异变]');
              const isBondLog = log.includes('[羁绊]');
              const isBurnLog = log.includes('[灼烧]');
              
              let textColor = 'text-text-dim';
              if (isSymbiosisLog) textColor = 'text-teal-300 font-semibold';
              else if (isForestRecoveryLog) textColor = 'text-emerald-300 font-semibold';
              else if (isHpRecoveryLog) textColor = 'text-emerald-200/90';
              else if (isForestGrowthLog) textColor = 'text-emerald-400/90';
              else if (isForestMutation) textColor = 'text-lime-300/85';
              else if (isGlacierLog) textColor = 'text-cyan-200/90';
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
        </div>
      </div>

      {/* Footer / Hand */}
      <div className="h-[240px] bg-surface border-t border-border px-8 py-4 flex items-center justify-between z-20 relative select-none">
        
        {/* LEFT COLUMN: SHARED DRAW PILE */}
        <div className="w-[180px] flex flex-col items-center justify-center relative select-none">
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
            <div className={`relative w-[50px] h-[70px] flex items-center justify-center transition-transform duration-250 ${
              sharedDeckScale ? 'scale-[1.08]' : ''
            }`}>
              {/* Card 3 (Bottom) */}
              {state.drawPile.length > 2 && (
                <div className="absolute w-[44px] h-[64px] bg-zinc-850 border border-zinc-750/30 rounded-md translate-x-1 translate-y-1 rotate-6 opacity-30 shadow-sm" />
              )}
              {/* Card 2 (Middle) */}
              {state.drawPile.length > 1 && (
                <div className="absolute w-[46px] h-[66px] bg-zinc-800 border border-zinc-700 rounded-md translate-x-0.5 translate-y-0.5 rotate-3 opacity-60 shadow flex items-center justify-center" />
              )}
              {/* Card 1 (Top) */}
              <div className={`absolute w-[48px] h-[68px] bg-[#1a1c23] border rounded-md flex items-center justify-center shadow-md transition-all ${
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
        <div className="flex-1 flex flex-col items-center justify-center gap-5">
          <div className={`text-[10px] font-mono font-bold text-emerald-200/80 tracking-wider leading-tight text-center transition-transform duration-200 ${playerMutationCountPulse ? 'scale-110' : 'scale-100'}`}>
            <div>🌿 我方手牌异变：{playerMutationCount} / {MUTATION_LIMIT}</div>
            {playerMutationCount >= MUTATION_LIMIT && (
              <div className="mt-0.5 text-[9px] text-emerald-200/45">已达上限</div>
            )}
          </div>
          <div className="flex gap-4 min-h-[120px] items-center">
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
                      ${card.mutationType === 'GLACIER' ? `glacier-card ${mutatedCardGlowIds[card.id] ? 'glacier-card--fresh' : ''}` : ''}
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
                  </motion.div>
                );
              })
            )}
          </div>

          <div className="flex gap-4">
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
                disabled={playerHasRerolledThisTurn || !isPlayerTurnState || isProcessing || state.drawPile.length === 0}
                title={state.drawPile.length === 0 ? zhCN.notices.rerollDeckEmpty : undefined}
                className="w-[180px] h-[40px] rounded-lg font-bold text-white bg-[#2d2d35]/50 border border-zinc-800/40 tracking-wider transition-all duration-200 hover:bg-zinc-700 active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:bg-[#1a1a20]/60 disabled:text-text-dim/20 disabled:border disabled:border-zinc-800/40 flex flex-col items-center justify-center leading-tight shadow-md"
              >
                <span className="text-[11px] font-black tracking-wider">
                  {zhCN.actions.rerollOne}
                </span>
              </button>
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
                const rightDisabled = !isPlayerTurnState || isProcessing || (state.phase === 'PLAYER_ATTACK' && selectedCards.length === 0) || state.winner !== null;

                let rightTextEng = zhCN.actions.confirmPlay;
                let rightTextChn = "";

                if (isDefend) {
                  if (hasSelected) {
                    rightTextEng = zhCN.actions.confirmDefense(selectedCards.length);
                    rightTextChn = "";
                  } else {
                    rightTextEng = zhCN.actions.pass;
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
        <div className="w-[180px] flex flex-col items-center justify-center relative select-none">
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

      {/* Rules Mini Info */}
      <div className="absolute top-[210px] right-10 text-[10px] text-text-dim/55 tracking-widest font-mono space-y-1.5 text-right pointer-events-none select-none max-w-[210px]">
        <p className="font-extrabold text-text-dim/80">{zhCN.resources.initialSharedDeck}</p>
        <p className="text-[9px] text-text-dim/45 leading-tight">{zhCN.resources.sharedDeckRule}</p>
        <p className="text-[9px] text-text-dim/45 leading-tight">弃牌区：双方独立记录</p>
        <p className="text-[9px] text-text-dim/45 leading-tight">{zhCN.resources.noReshuffle}</p>
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
        {glacierRecycleFeedback && (
          <motion.div
            key={`glacier-recycle-${glacierRecycleFeedback.token}`}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: [0, 1, 1, 0], y: [8, 0, -2, -6], scale: [0.96, 1, 1, 0.98] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.85, ease: 'easeOut' }}
            className="absolute left-1/2 top-[286px] z-[118] -translate-x-1/2 rounded-lg border border-cyan-300/35 bg-[#06121a]/92 px-4 py-2 text-center font-mono shadow-[0_0_24px_rgba(34,211,238,0.16)] pointer-events-none"
          >
            <div className="text-[12px] font-black tracking-widest text-cyan-100">❄️ 冰封回收</div>
            <div className="mt-1 text-[10px] font-bold text-cyan-50/72">冰川牌返回手牌</div>
          </motion.div>
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
              className={`w-[420px] rounded-xl border ${isGlacierEnvironment ? 'border-cyan-300/35 bg-[#06121a]/92 shadow-[0_18px_50px_rgba(0,0,0,0.45),0_0_24px_rgba(34,211,238,0.12)]' : 'border-emerald-500/35 bg-[#07120d]/92 shadow-[0_18px_50px_rgba(0,0,0,0.45),0_0_24px_rgba(16,185,129,0.12)]'} p-5 backdrop-blur-md font-mono text-center pointer-events-auto`}
            >
              <h3 className={`${isGlacierEnvironment ? 'text-cyan-100' : 'text-emerald-200'} text-sm font-black tracking-widest`}>
                {ACTIVE_ENVIRONMENT_CONFIG.icon} {activeMutationLabel}感染
              </h3>
              <p className={`mt-1 text-[11px] ${isGlacierEnvironment ? 'text-cyan-50/75' : 'text-emerald-100/75'} font-semibold`}>
                请选择 1 张手牌感染为{isGlacierEnvironment ? '冰川牌' : '森林幼苗'}
              </p>
              <div className="mt-5 flex items-center justify-center gap-4">
                {mutationCandidates.map(card => (
                  <button
                    key={card.id}
                    onClick={() => handleMutationPick(card.id)}
                    title={isGlacierEnvironment
                      ? `感染后：\n❄️ ${glacierCardLabel(card.type)}\n\n平局后返回手牌并恢复为普通牌`
                      : `感染后：\n🌱 ${forestCardLabel(card.type)}·幼苗\n\n完整保留 1 次交锋后成熟\n成熟后命中可恢复 HP`
                    }
                    className={`group w-[126px] h-[154px] rounded-xl bg-surface border ${isGlacierEnvironment ? 'border-cyan-300/30 hover:border-cyan-200' : 'border-emerald-500/30 hover:border-emerald-300'} flex flex-col items-center justify-center relative card-shadow cursor-pointer hover:-translate-y-1 transition-all ${getCardBorderClass(card.type)}`}
                  >
                    <div className={`absolute top-2 right-2 text-[14px] ${isGlacierEnvironment ? 'drop-shadow-[0_0_6px_rgba(125,211,252,0.45)]' : 'drop-shadow-[0_0_6px_rgba(52,211,153,0.45)]'}`} aria-hidden="true">
                      {isGlacierEnvironment ? '❄️' : '🌱'}
                    </div>
                    <CardIcon type={card.type} className="text-4xl mb-2" />
                    <div className="text-[10px] font-bold tracking-wider text-text-dim leading-relaxed">
                      <div>普通{plainCardLabel(card.type)}</div>
                      <div className={isGlacierEnvironment ? 'text-cyan-100/90' : 'text-emerald-200/90'}>
                        → {isGlacierEnvironment ? glacierCardLabel(card.type) : `${forestCardLabel(card.type)}·幼苗`}
                      </div>
                    </div>
                    <div className={`absolute -bottom-20 left-1/2 hidden w-[188px] -translate-x-1/2 rounded-md border ${isGlacierEnvironment ? 'border-cyan-300/25 text-cyan-50/75' : 'border-emerald-500/25 text-emerald-100/75'} bg-[#111]/95 px-2 py-1.5 text-[9px] leading-relaxed shadow-xl group-hover:block`}>
                      <div className={`font-black ${isGlacierEnvironment ? 'text-cyan-100' : 'text-emerald-200'}`}>感染后：</div>
                      <div>{isGlacierEnvironment ? '❄️' : '🌱'} {isGlacierEnvironment ? glacierCardLabel(card.type) : `${forestCardLabel(card.type)}·幼苗`}</div>
                      {isGlacierEnvironment ? (
                        <>
                          <div className="mt-1 text-cyan-50/55">平局后返回手牌</div>
                          <div className="text-cyan-50/55">并恢复为普通牌</div>
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
                  {isGlacierEnvironment ? '❄️' : '🌱'}
                </span>
                <span className={`absolute -left-5 top-4 text-[10px] opacity-75 ${isGlacierEnvironment ? 'drop-shadow-[0_0_6px_rgba(125,211,252,0.65)]' : 'drop-shadow-[0_0_6px_rgba(52,211,153,0.65)]'}`}>
                  {ACTIVE_ENVIRONMENT_CONFIG.icon}
                </span>
                <span className={`absolute left-5 top-7 text-[9px] opacity-60 ${isGlacierEnvironment ? 'drop-shadow-[0_0_6px_rgba(125,211,252,0.65)]' : 'drop-shadow-[0_0_6px_rgba(52,211,153,0.65)]'}`}>
                  {isGlacierEnvironment ? '❄️' : '🌱'}
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
              对手获得 1 张{activeMutationLabel}异变牌
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
          overflow: hidden;
        }

        .glacier-card.border-accent {
          border-color: rgb(245, 158, 11) !important;
        }

        .glacier-card::before {
          content: "";
          position: absolute;
          inset: 6px;
          border-radius: 9px;
          pointer-events: none;
          opacity: 0.40;
          background:
            linear-gradient(120deg, transparent 0 30%, rgba(186, 230, 253, 0.28) 30.5% 31.5%, transparent 32% 100%),
            linear-gradient(35deg, transparent 0 64%, rgba(125, 211, 252, 0.22) 64.5% 65.5%, transparent 66% 100%),
            radial-gradient(circle at 82% 22%, rgba(224, 242, 254, 0.36) 0 1px, transparent 2px);
        }

        .glacier-card--fresh {
          animation: glacier-card-arrive 0.82s ease-out;
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
      className={`w-[90px] h-[120px] rounded-xl bg-surface border border-border flex flex-col items-center justify-center relative shadow-xl ${getCardBorderClass(card.type)} ${card.mutationType === 'VOLCANO' ? 'lava-card' : ''} ${card.mutationType === 'FOREST' ? `forest-card forest-card--${card.forestGrowthStage === 'MATURE' ? 'mature' : 'seedling'}` : ''} ${card.mutationType === 'GLACIER' ? 'glacier-card' : ''}`}
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
    </motion.div>
  );
}
