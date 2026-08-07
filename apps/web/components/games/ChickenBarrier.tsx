'use client';

const LANES = 6;

export interface ChickenBarrierProps {
  crossed: number;
  windowStart: number;
}

export function ChickenBarrier({ crossed, windowStart }: ChickenBarrierProps) {
  return (
    <div className="barrier" aria-hidden="true">
      {Array.from({ length: LANES }, (_, i) => {
        const lane = windowStart + i;
        const down = lane < crossed;
        const latest = lane === crossed - 1;

        return (
          <div className="barrier__lane" key={lane}>
            <div
              className={`barrier__pole${down ? ' barrier__pole--down' : ''}`}
            >
              <span className="barrier__stripes" />
            </div>
            {down && (
              <span
                className={`barrier__check${latest ? ' barrier__check--live' : ''}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ChickenBarrier;
