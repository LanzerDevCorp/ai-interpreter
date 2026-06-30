'use client';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Direction } from '@/lib/types';

export interface DirectionToggleProps {
  value: Direction;
  onChange: (direction: Direction) => void;
}

/**
 * Segmented ES/KO control that selects who is about to speak. Purely
 * controlled: it only reports the requested `Direction` upward and never
 * touches turn state itself, so it only ever affects the next turn — already
 * confirmed turns keep whatever direction they were created with.
 */
export function DirectionToggle({ value, onChange }: DirectionToggleProps) {
  const koreanActive = value === 'ko-es';

  return (
    <div className="flex items-center gap-3" role="group" aria-label="¿Quién habla?">
      <span
        className={cn(
          'text-sm font-medium transition-colors',
          koreanActive ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        ES
      </span>
      <Switch
        checked={koreanActive}
        onCheckedChange={(checked) => onChange(checked ? 'ko-es' : 'es-ko')}
        aria-label="Cambiar idioma del hablante"
      />
      <span
        className={cn(
          'text-sm font-medium transition-colors',
          koreanActive ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        KO
      </span>
    </div>
  );
}
