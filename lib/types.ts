export type Direction = 'es-ko' | 'ko-es';

export type TurnStatus =
  | 'recording'
  | 'transcribing'
  | 'translating'
  | 'back-translating'
  | 'done'
  | 'error';

export type Turn = {
  id: string;
  direction: Direction;
  original: string;
  translated: string;
  /**
   * Literal round-trip of `translated` back into the speaker's source language,
   * produced by /api/backtranslate. Lets the speaker verify the translation kept
   * their meaning. Empty until back-translation resolves (or if it fails/old turn).
   * Renders on the TARGET panel side (not the speaker's side).
   */
  backTranslation: string;
  status: TurnStatus;
  timestamp: number;
  error?: string;
};
