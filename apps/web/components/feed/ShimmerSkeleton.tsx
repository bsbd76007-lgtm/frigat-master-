'use client';

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
