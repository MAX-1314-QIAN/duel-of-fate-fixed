import { Card, CardType, MutationType } from '../types';

export const VOLCANO_ENVIRONMENT_CONFIG = {
  id: 'VOLCANO',
  name: '火山事件',
  icon: '🔥',
  mutationIntervalRounds: 2,
  maxMutationCardsPerSide: 3,
  maxMutationDamageBonusPerClash: 2,
  resonanceRequiredCards: 2,
  resonanceBonusDamage: 1,
} as const;

export const FOREST_ENVIRONMENT_CONFIG = {
  id: 'FOREST',
  name: '森林事件',
  icon: '🌿',
  mutationIntervalRounds: 2,
  maxMutationCardsPerSide: 3,
} as const;

export const GLACIER_ENVIRONMENT_CONFIG = {
  id: 'GLACIER',
  name: '冰川事件',
  icon: '❄️',
  mutationIntervalRounds: 2,
  maxMutationCardsPerSide: 3,
} as const;

export const DEFAULT_ENVIRONMENT_ROUTE = [
  'VOLCANO',
  'FOREST',
  'GLACIER',
] as const;

export const ENVIRONMENT_ROUTE_CONFIG = {
  roundsPerEnvironment: 2,
  mutationIntervalRounds: 2,
} as const;

export const ACTIVE_ENVIRONMENT_CONFIG = VOLCANO_ENVIRONMENT_CONFIG;

export const MUTATION_LIMIT = ACTIVE_ENVIRONMENT_CONFIG.maxMutationCardsPerSide;
export const MUTATION_INTERVAL_ROUNDS = ENVIRONMENT_ROUTE_CONFIG.mutationIntervalRounds;

const shuffleCards = (cards: Card[]) => [...cards].sort(() => Math.random() - 0.5);

export const getMutationCandidates = (hand: Card[]) => {
  const normalCardsByType = shuffleCards(hand.filter(card => !card.mutationType))
    .reduce<Partial<Record<CardType, Card[]>>>((groups, card) => {
      groups[card.type] = [...(groups[card.type] ?? []), card];
      return groups;
    }, {});

  return shuffleCards(Object.values(normalCardsByType).map(cards => cards[0])).slice(0, 2);
};

export const countMutatedCards = (hand: Card[]) =>
  hand.filter(card => card.mutationType === 'VOLCANO').length;

export const getForestMutationCandidates = (hand: Card[]) =>
  shuffleCards(hand.filter(card => !card.mutationType)).slice(0, 2);

export const getGlacierMutationCandidates = (hand: Card[]) =>
  shuffleCards(hand.filter(card => !card.mutationType)).slice(0, 2);

export const countAllMutatedCards = (hand: Card[]) =>
  hand.filter(card => card.mutationType).length;

export const calculateForestRecovery = ({
  successfulMatureForestHits,
  playedMatureForestCards,
  currentHp,
  maxHp,
}: {
  successfulMatureForestHits: number;
  playedMatureForestCards: number;
  currentHp: number;
  maxHp: number;
}) => {
  const baseRecovery = successfulMatureForestHits;
  const symbiosisTriggered =
    playedMatureForestCards >= 2
    && successfulMatureForestHits >= 1;
  const symbiosisBonus = symbiosisTriggered ? 1 : 0;
  const cappedRecovery = Math.min(baseRecovery + symbiosisBonus, 2);
  const finalRecovery = Math.min(cappedRecovery, Math.max(0, maxHp - currentHp));

  return {
    baseRecovery,
    symbiosisTriggered,
    symbiosisBonus,
    cappedRecovery,
    finalRecovery,
  };
};

export const calculateVolcanoMutationBonus = (successfulVolcanoHits: number) =>
  Math.min(successfulVolcanoHits, VOLCANO_ENVIRONMENT_CONFIG.maxMutationDamageBonusPerClash);

export const calculateVolcanoDamage = ({
  baseDamage,
  successfulVolcanoHits,
  playedVolcanoCards,
}: {
  baseDamage: number;
  successfulVolcanoHits: number;
  playedVolcanoCards: number;
}) => {
  const mutationBonus = calculateVolcanoMutationBonus(successfulVolcanoHits);
  const resonanceTriggered =
    playedVolcanoCards >= VOLCANO_ENVIRONMENT_CONFIG.resonanceRequiredCards
    && successfulVolcanoHits >= 1;
  const resonanceBonus = resonanceTriggered
    ? VOLCANO_ENVIRONMENT_CONFIG.resonanceBonusDamage
    : 0;

  return {
    baseDamage,
    mutationBonus,
    resonanceTriggered,
    resonanceBonus,
    totalDamage: baseDamage + mutationBonus + resonanceBonus,
  };
};

export const getVolcanoMutationBonus = (damagingCards: Card[]) =>
  calculateVolcanoMutationBonus(
    damagingCards.filter(card => card.mutationType === 'VOLCANO').length
  );

export const getVolcanoResonanceBonus = ({
  playedCards,
  damagingCards,
}: {
  playedCards: Card[];
  damagingCards: Card[];
}) => {
  const playedVolcanoCount = playedCards.filter(card => card.mutationType === 'VOLCANO').length;
  const damagingVolcanoCount = damagingCards.filter(card => card.mutationType === 'VOLCANO').length;

  return calculateVolcanoDamage({
    baseDamage: damagingCards.length,
    successfulVolcanoHits: damagingVolcanoCount,
    playedVolcanoCards: playedVolcanoCount,
  }).resonanceBonus;
};

export const canTriggerMutation = (sharedDeckCount: number, mutationCount: number) =>
  sharedDeckCount > 0 && mutationCount >= MUTATION_INTERVAL_ROUNDS;

export const selectAiMutationCandidate = (candidates: Card[], aiHand: Card[]) => {
  if (candidates.length === 0) return null;

  const typeCounts = aiHand.reduce<Record<CardType, number>>((counts, card) => {
    counts[card.type] += 1;
    return counts;
  }, { ROCK: 0, PAPER: 0, SCISSORS: 0 });

  const bestScore = Math.max(...candidates.map(card => typeCounts[card.type]));
  const bestCandidates = candidates.filter(card => typeCounts[card.type] === bestScore);

  return bestCandidates[Math.floor(Math.random() * bestCandidates.length)];
};

export const applyMutationToCard = (
  cardId: string,
  mutationType: MutationType,
  completedClashCount?: number,
) => (card: Card): Card =>
  card.id === cardId && !card.mutationType
    ? {
        ...card,
        mutationType,
        ...(mutationType === 'FOREST'
          ? {
              forestGrowthStage: 'SEEDLING' as const,
              forestMatureAfterClash: (completedClashCount ?? 0) + 1,
            }
          : {}),
        ...(mutationType === 'GLACIER'
          ? {
              glacierEchoUsed: false,
            }
          : {}),
      }
    : card;

export const removeMutationFromCard = (card: Card): Card => {
  const {
    mutationType,
    forestGrowthStage,
    forestMatureAfterClash,
    glacierEchoUsed,
    ...normalCard
  } = card;

  return normalCard;
};

export const advanceForestGrowth = ({
  hand,
  completedClashCount,
}: {
  hand: Card[];
  completedClashCount: number;
}) => {
  const maturedCards: Card[] = [];
  const nextHand = hand.map(card => {
    if (
      card.mutationType !== 'FOREST'
      || card.forestGrowthStage !== 'SEEDLING'
      || card.forestMatureAfterClash === undefined
      || card.forestMatureAfterClash > completedClashCount
    ) {
      return card;
    }

    const maturedCard = {
      ...card,
      forestGrowthStage: 'MATURE' as const,
    };
    maturedCards.push(maturedCard);
    return maturedCard;
  });

  return { hand: nextHand, maturedCards };
};
