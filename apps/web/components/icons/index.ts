import type { ComponentType } from 'react';

import type { GameIconProps } from '@/components/icons/types';
import { CrashIcon } from '@/components/icons/CrashIcon';
import { MinesIcon } from '@/components/icons/MinesIcon';
import { RouletteIcon } from '@/components/icons/RouletteIcon';
import { CoinflipIcon } from '@/components/icons/CoinflipIcon';
import { PlinkoIcon } from '@/components/icons/PlinkoIcon';
import { DiceIcon } from '@/components/icons/DiceIcon';
import { LimboIcon } from '@/components/icons/LimboIcon';
import { KenoIcon } from '@/components/icons/KenoIcon';
import { ChickenIcon } from '@/components/icons/ChickenIcon';
import { SlotsIcon } from '@/components/icons/SlotsIcon';
import { AviaIcon } from '@/components/icons/AviaIcon';
export type { GameIconProps } from '@/components/icons/types';
export { CrashIcon } from '@/components/icons/CrashIcon';
export { MinesIcon } from '@/components/icons/MinesIcon';
export { RouletteIcon } from '@/components/icons/RouletteIcon';
export { CoinflipIcon } from '@/components/icons/CoinflipIcon';
export { PlinkoIcon } from '@/components/icons/PlinkoIcon';
export { DiceIcon } from '@/components/icons/DiceIcon';
export { LimboIcon } from '@/components/icons/LimboIcon';
export { KenoIcon } from '@/components/icons/KenoIcon';
export { ChickenIcon } from '@/components/icons/ChickenIcon';
export { SlotsIcon } from '@/components/icons/SlotsIcon';
export { AviaIcon } from '@/components/icons/AviaIcon';

export type GameSlug =
  | 'crash'
  | 'mines'
  | 'roulette'
  | 'coinflip'
  | 'plinko'
  | 'dice'
  | 'limbo'
  | 'keno'
  | 'chicken'
  | 'slots'
  | 'avia-masters';

export const GAME_ICONS: Record<GameSlug, ComponentType<GameIconProps>> = {
  crash: CrashIcon,
  mines: MinesIcon,
  roulette: RouletteIcon,
  coinflip: CoinflipIcon,
  plinko: PlinkoIcon,
  dice: DiceIcon,
  limbo: LimboIcon,
  keno: KenoIcon,
  chicken: ChickenIcon,
  slots: SlotsIcon,
  'avia-masters': AviaIcon,
};
