import { Card } from '../types';

export interface RecycleDiscardPilesInput {
  playerDiscardPile: Card[];
  aiDiscardPile: Card[];
}

export interface RecycleDiscardPilesResult {
  recycledDeck: Card[];
  recycledCount: number;
  normalizedMutationCount: number;
}

const shuffleCards = (cards: Card[]) => [...cards].sort(() => Math.random() - 0.5);

export const normalizeCardForSharedDeck = (card: Card): Card => {
  const {
    mutationType,
    forestGrowthStage,
    forestMatureAfterClash,
    glacierEchoUsed,
    ...normalCard
  } = card;

  return normalCard;
};

export const recycleDiscardPilesIntoSharedDeck = ({
  playerDiscardPile,
  aiDiscardPile,
}: RecycleDiscardPilesInput): RecycleDiscardPilesResult => {
  const cardsToRecycle = [...playerDiscardPile, ...aiDiscardPile];
  const normalizedMutationCount = cardsToRecycle.filter(card =>
    card.mutationType !== undefined
    || card.forestGrowthStage !== undefined
    || card.forestMatureAfterClash !== undefined
    || card.glacierEchoUsed !== undefined
  ).length;

  return {
    recycledDeck: shuffleCards(cardsToRecycle.map(normalizeCardForSharedDeck)),
    recycledCount: cardsToRecycle.length,
    normalizedMutationCount,
  };
};
