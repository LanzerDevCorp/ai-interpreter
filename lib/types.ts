export type Direction = 'es-ko' | 'ko-es';

export type TurnStatus =
  | 'recording'
  | 'transcribing'
  | 'translating'
  | 'done'
  | 'error';

export type Turn = {
  id: string;
  direction: Direction;
  original: string;
  translated: string;
  gloss: string;
  status: TurnStatus;
  timestamp: number;
  error?: string;
};
