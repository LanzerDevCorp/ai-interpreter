import type { Direction } from './types';

export type GlossaryEntry = {
  es: string;
  ko: string;
  nota?: string;
};

export type GlossaryCategory = 'procedimientos' | 'finanzas' | 'marcas';

export const glossary: Record<GlossaryCategory, GlossaryEntry[]> = {
  procedimientos: [
    { es: 'bótox', ko: '보톡스' },
    { es: 'ácido hialurónico', ko: '히알루론산' },
    { es: 'hilos tensores', ko: '실리프팅' },
    { es: 'peeling químico', ko: '화학적 필링' },
    { es: 'mesoterapia', ko: '메조테라피' },
  ],
  finanzas: [
    { es: 'seña / anticipo', ko: '계약금' },
    { es: 'cuotas / plan de pagos', ko: '할부' },
    { es: 'factura', ko: '세금계산서' },
    { es: 'IVA', ko: '부가가치세' },
    { es: 'presupuesto', ko: '견적서' },
  ],
  marcas: [
    { es: 'Allergan', ko: 'Allergan', nota: 'mantener en forma original' },
    { es: 'Juvederm', ko: 'Juvederm', nota: 'mantener en forma original' },
    { es: 'Restylane', ko: 'Restylane', nota: 'mantener en forma original' },
    { es: 'Ultherapy', ko: 'Ultherapy', nota: 'mantener en forma original' },
  ],
};

const CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  procedimientos: 'Procedimientos',
  finanzas: 'Finanzas',
  marcas: 'Marcas',
};

/**
 * Renders the glossary as a source-term-first block for the active
 * translation direction. Safe to call even if a category has no entries.
 */
export function buildGlossaryBlock(direction: Direction): string {
  const categories = Object.keys(glossary) as GlossaryCategory[];

  const sections = categories
    .map((category) => {
      const entries = glossary[category];
      if (entries.length === 0) return null;

      const lines = entries.map((entry) => {
        const [source, target] =
          direction === 'es-ko' ? [entry.es, entry.ko] : [entry.ko, entry.es];
        const note = entry.nota ? ` (${entry.nota})` : '';
        return `- ${source} -> ${target}${note}`;
      });

      return `${CATEGORY_LABELS[category]}:\n${lines.join('\n')}`;
    })
    .filter((section): section is string => section !== null);

  if (sections.length === 0) {
    return 'Glosario: (sin entradas)';
  }

  return `Glosario (término en idioma de origen -> término en idioma de destino):\n${sections.join('\n\n')}`;
}
