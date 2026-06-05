export type CardType = 'ROCK' | 'PAPER' | 'SCISSORS';
export type MutationType = 'VOLCANO' | 'FOREST';
export type ForestGrowthStage = 'SEEDLING' | 'MATURE';

export interface Card {
  id: string;
  type: CardType;
  mutationType?: MutationType;
  forestGrowthStage?: ForestGrowthStage;
  forestMatureAfterClash?: number;
}

export type PlayerRole = 'HOME' | 'GUEST';

export type GamePhase = 
  | 'PLAYER_ATTACK' 
  | 'AI_DEFEND' 
  | 'AI_ATTACK' 
  | 'PLAYER_DEFEND' 
  | 'REVEAL'
  | 'RESOLVE' 
  | 'GAME_OVER';

export interface GameState {
  playerHP: number;
  aiHP: number;
  playerHand: Card[];
  aiHand: Card[];
  playerRole: PlayerRole;
  aiRole: PlayerRole;
  phase: GamePhase;
  homePlayed: Card[];
  guestPlayed: Card[];
  lastAction: string;
  winner: 'PLAYER' | 'AI' | 'DRAW' | null;
  drawPile: Card[];
  playerDiscardPile: Card[];
  aiDiscardPile: Card[];
}

export const WIN_MAP: Record<CardType, CardType> = {
  ROCK: 'SCISSORS',
  PAPER: 'ROCK',
  SCISSORS: 'PAPER',
};
