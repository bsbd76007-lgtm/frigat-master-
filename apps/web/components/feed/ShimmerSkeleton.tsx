'use client';

/**
 * FRIGAT — Loading skeletons
 *
 * Placeholders that hold the exact shape of the content still loading, so the
 * page does not jump when real data lands. Both variants below are sized from
 * the same measurements as the components they stand in for — a skeleton that
 * is the wrong height is worse than none, since it swaps one layout shift for
 * two.
 *
 * The shimmer is a moving highlight over a flat block. It is decorative, so
 * every skeleton is `aria-hidden` and the live region announcing "loading" is
 * left to the component that owns the data.
 */

interface ShimmerSkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
}

export function ShimmerSkeleton({
  width = '100%',
  height = '1em',
  radius = '8px',
  className,
}: ShimmerSkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`shimmer${className ? ` ${className}` : ''}`}
      style={{ width, height, borderRadius: radius }}
    />
  );
}

/**
 * Stand-in for the game grid.
 *
 * Renders inside the same `.grid` container as the real tiles so the column
 * count, gap and tile footprint are identical — the skeleton and the content
 * occupy the same space at every breakpoint because they share one rule.
 */
export function GameGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="tile-skel" key={i}>
          <span className="shimmer tile-skel__icon" />
          <span className="shimmer tile-skel__name" />
          <span className="shimmer tile-skel__blurb" />
        </div>
      ))}
    </div>
  );
}

export function FeedSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="feed__list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="feed-skel" key={i}>
          <span className="feed-skel__left">
            <span className="shimmer feed-skel__icon" />
            <span
              className="shimmer feed-skel__name"
              // Varied widths so the column reads as a list of different game
              // names rather than a stack of identical bars.
              style={{ width: `${58 + ((i * 23) % 46)}px` }}
            />
          </span>
          <span className="shimmer feed-skel__payout" />
        </div>
      ))}
    </div>
  );
}

export default ShimmerSkeleton;
