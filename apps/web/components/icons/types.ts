/**
 * FRIGAT — Game icon contract
 *
 * Every game icon takes the same props so the cards can render them from a
 * lookup table. Gradient and filter ids are namespaced with a `useId()` value
 * inside each component: two cards on the same page would otherwise define the
 * same `<linearGradient id>` twice, and SVG resolves such a reference to the
 * first match in the document — the second icon would silently borrow the
 * first one's fill.
 */

import type { SVGProps } from 'react';

export interface GameIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  title?: string;
}
