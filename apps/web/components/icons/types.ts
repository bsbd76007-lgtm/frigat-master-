import type { SVGProps } from 'react';

export interface GameIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  title?: string;
}
