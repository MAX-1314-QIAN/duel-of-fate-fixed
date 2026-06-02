export type DrawUser = 'PLAYER' | 'AI';

export interface LimitedSharedDeckDrawInput {
  deckCount: number;
  playerNeed: number;
  aiNeed: number;
  nextHomeSide: DrawUser;
}

export interface DrawQueueItem {
  user: DrawUser;
  count: number;
}

export const allocateLimitedSharedDeckDraws = ({
  deckCount,
  playerNeed,
  aiNeed,
  nextHomeSide,
}: LimitedSharedDeckDrawInput): DrawQueueItem[] => {
  const queue: DrawQueueItem[] = [];
  let remainingDeck = deckCount;
  let playerRemaining = playerNeed;
  let aiRemaining = aiNeed;
  let turn: DrawUser = nextHomeSide;

  while (remainingDeck > 0 && (playerRemaining > 0 || aiRemaining > 0)) {
    if (turn === 'PLAYER') {
      if (playerRemaining > 0) {
        queue.push({ user: 'PLAYER', count: 1 });
        playerRemaining -= 1;
        remainingDeck -= 1;
      }
      turn = 'AI';
    } else {
      if (aiRemaining > 0) {
        queue.push({ user: 'AI', count: 1 });
        aiRemaining -= 1;
        remainingDeck -= 1;
      }
      turn = 'PLAYER';
    }
  }

  return queue;
};
