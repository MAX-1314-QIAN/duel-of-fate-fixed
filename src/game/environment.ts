import { Card, CardType, MutationType } from '../types';

export const MUTATION_LIMIT = 3;
export const MUTATION_INTERVAL_ROUNDS = 2;

const shuffleCards = (cards: Card[]) => [...cards].sort(() => Math.random() - 0.5);

export const getMutationCandidates = (hand: Card[]) =>
  shuffleCards(hand.filter(card => !card.mutationType)).slice(0, 2);

export const countMutatedCards = (hand: Card[]) =>
  hand.filter(card => card.mutationType === 'VOLCANO').length;

export const getVolcanoMutationBonus = (damagingCards: Card[]) =>
  damagingCards.filter(card => card.mutationType === 'VOLCANO').length;

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
) => (card: Card): Card =>
  card.id === cardId && !card.mutationType
    ? { ...card, mutationType }
    : card;
