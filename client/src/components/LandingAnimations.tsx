import * as React from "react";

/* ─────────────────────────────────────────────
   Animated SVG components for the landing page.
   All pixel-art style: crispEdges, rects only,
   SMIL <animate> for motion, no JS loops.
   ───────────────────────────────────────────── */

// Respect prefers-reduced-motion
function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    if (mq.addEventListener) {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    const fallback = (e: MediaQueryListEvent) => handler(e);
    mq.addListener(fallback);
    return () => mq.removeListener(fallback);
  }, []);
  return reduced;
}

/* ── 1. DRIFTING PIXEL CLOUDS (Hero background) ── */

function PixelCloud({ y, scale, dur, delay }: { y: number; scale: number; dur: number; delay: number }) {
  // NES-style cloud: stacked rects
  return (
    <g opacity="0.35" transform={`scale(${scale})`}>
      <rect x="-4" y={y} width="4" height="4" fill="#9aa7cc" />
      <rect x="0" y={y} width="4" height="4" fill="#c8d0e8" />
      <rect x="4" y={y} width="4" height="4" fill="#c8d0e8" />
      <rect x="8" y={y} width="4" height="4" fill="#c8d0e8" />
      <rect x="12" y={y} width="4" height="4" fill="#9aa7cc" />
      <rect x="-8" y={y + 4} width="4" height="4" fill="#9aa7cc" />
      <rect x="-4" y={y + 4} width="4" height="4" fill="#d6deff" />
      <rect x="0" y={y + 4} width="4" height="4" fill="#e8ecff" />
      <rect x="4" y={y + 4} width="4" height="4" fill="#e8ecff" />
      <rect x="8" y={y + 4} width="4" height="4" fill="#e8ecff" />
      <rect x="12" y={y + 4} width="4" height="4" fill="#d6deff" />
      <rect x="16" y={y + 4} width="4" height="4" fill="#9aa7cc" />
      <rect x="-4" y={y + 8} width="4" height="4" fill="#9aa7cc" />
      <rect x="0" y={y + 8} width="4" height="4" fill="#c8d0e8" />
      <rect x="4" y={y + 8} width="4" height="4" fill="#c8d0e8" />
      <rect x="8" y={y + 8} width="4" height="4" fill="#c8d0e8" />
      <rect x="12" y={y + 8} width="4" height="4" fill="#9aa7cc" />
      <animateTransform
        attributeName="transform"
        type="translate"
        values={`320,0; -80,0`}
        dur={`${dur}s`}
        begin={`${delay}s`}
        repeatCount="indefinite"
      />
    </g>
  );
}

export function DriftingClouds({ disabled = false }: { disabled?: boolean }): React.ReactElement | null {
  const reduced = useReducedMotion();
  if (disabled || reduced) return null;
  return (
    <svg
      className="absolute inset-0 h-full w-full pointer-events-none"
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <PixelCloud y={80} scale={2} dur={38} delay={0} />
      <PixelCloud y={110} scale={1.5} dur={50} delay={6} />
      <PixelCloud y={95} scale={1.8} dur={44} delay={15} />
      <PixelCloud y={130} scale={1.2} dur={55} delay={10} />
      <PixelCloud y={60} scale={1.6} dur={48} delay={22} />
    </svg>
  );
}

/* ── 2. LOGO SPARKLES ── */

function Sparkle({ x, y, color, dur, delay }: { x: number; y: number; color: string; dur: number; delay: number }) {
  // Tiny 3x3 cross shape
  return (
    <g>
      <rect x={x} y={y - 2} width="2" height="2" fill={color} />
      <rect x={x - 2} y={y} width="2" height="2" fill={color} />
      <rect x={x} y={y} width="2" height="2" fill={color} />
      <rect x={x + 2} y={y} width="2" height="2" fill={color} />
      <rect x={x} y={y + 2} width="2" height="2" fill={color} />
      <animate
        attributeName="opacity"
        values="0;0.8;0"
        dur={`${dur}s`}
        begin={`${delay}s`}
        repeatCount="indefinite"
      />
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0,0; 0,-2; 0,0"
        dur={`${dur}s`}
        begin={`${delay}s`}
        repeatCount="indefinite"
      />
    </g>
  );
}

export function LogoSparkles({ disabled = false }: { disabled?: boolean }): React.ReactElement | null {
  const reduced = useReducedMotion();
  if (disabled || reduced) return null;
  return (
    <svg
      className="absolute inset-0 h-full w-full pointer-events-none"
      viewBox="0 0 200 60"
      preserveAspectRatio="xMidYMid slice"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <Sparkle x={15} y={10} color="#ffcc00" dur={2.2} delay={0} />
      <Sparkle x={185} y={12} color="#ffffff" dur={1.8} delay={0.5} />
      <Sparkle x={40} y={45} color="#ffcc00" dur={2.5} delay={1.0} />
      <Sparkle x={160} y={42} color="#ffffff" dur={2.0} delay={0.3} />
      <Sparkle x={90} y={5} color="#ffcc00" dur={2.8} delay={1.5} />
      <Sparkle x={110} y={50} color="#ffffff" dur={2.3} delay={0.8} />
      <Sparkle x={5} y={30} color="#54f28b" dur={3.0} delay={1.2} />
      <Sparkle x={195} y={28} color="#54f28b" dur={2.6} delay={0.1} />
    </svg>
  );
}

/* ── 3. RADAR PING (Live World stats) ── */

export function RadarPing({ color, disabled = false }: { color: string; disabled?: boolean }): React.ReactElement | null {
  const reduced = useReducedMotion();
  if (disabled || reduced) return null;
  return (
    <svg
      className="absolute inset-0 h-full w-full pointer-events-none"
      viewBox="0 0 60 60"
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* Ring 1 */}
      <rect x="20" y="20" width="20" height="20" fill="none" stroke={color} strokeWidth="2" opacity="0">
        <animate attributeName="opacity" values="0.6;0" dur="2s" begin="0s" repeatCount="indefinite" />
        <animateTransform
          attributeName="transform"
          type="scale"
          values="1;2.2"
          dur="2s"
          begin="0s"
          repeatCount="indefinite"
          additive="sum"
        />
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0;-10,-10"
          dur="2s"
          begin="0s"
          repeatCount="indefinite"
          additive="sum"
        />
      </rect>
      {/* Ring 2 (staggered) */}
      <rect x="20" y="20" width="20" height="20" fill="none" stroke={color} strokeWidth="2" opacity="0">
        <animate attributeName="opacity" values="0.6;0" dur="2s" begin="0.7s" repeatCount="indefinite" />
        <animateTransform
          attributeName="transform"
          type="scale"
          values="1;2.2"
          dur="2s"
          begin="0.7s"
          repeatCount="indefinite"
          additive="sum"
        />
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0;-10,-10"
          dur="2s"
          begin="0.7s"
          repeatCount="indefinite"
          additive="sum"
        />
      </rect>
      {/* Center dot */}
      <rect x="27" y="27" width="6" height="6" fill={color} opacity="0.5">
        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="1.5s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

/* ── 4. GLOWING PIXEL DIVIDER ── */

export function PixelDivider({ color = "#ffcc00" }: { color?: string }): React.ReactElement {
  const reduced = useReducedMotion();
  return (
    <div className="z-10 w-full max-w-3xl px-4 py-2">
      <svg
        className="w-full"
        viewBox="0 0 600 6"
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        aria-hidden="true"
        style={{ height: "6px" }}
      >
        {/* Static dashed line */}
        {Array.from({ length: 60 }, (_, i) => (
          <rect
            key={i}
            x={i * 10 + 1}
            y="2"
            width="6"
            height="2"
            fill={color}
            opacity="0.2"
          />
        ))}
        {/* Traveling glow segment */}
        {!reduced && (
          <rect x="0" y="0" width="40" height="6" fill={color} opacity="0.6" rx="0">
            <animateTransform
              attributeName="transform"
              type="translate"
              values="-40,0; 600,0"
              dur="4s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0;0.7;0.7;0"
              keyTimes="0;0.1;0.9;1"
              dur="4s"
              repeatCount="indefinite"
            />
          </rect>
        )}
      </svg>
    </div>
  );
}

/* ── 5. FLOATING ESSENCE PARTICLES ── */

const PARTICLE_COLORS = ["#ffcc00", "#54f28b", "#44ddff", "#aa44ff", "#ffcc00", "#54f28b", "#44ddff", "#ff4d6d", "#ffcc00", "#54f28b"];

function EssenceParticle({ x, color, dur, delay }: { x: number; color: string; dur: number; delay: number }) {
  return (
    <g>
      <rect x={x} y="100" width="3" height="3" fill={color}>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={`0,0; ${Math.round(Math.sin(x) * 8)},-110`}
          dur={`${dur}s`}
          begin={`${delay}s`}
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0;0.5;0.5;0"
          keyTimes="0;0.15;0.7;1"
          dur={`${dur}s`}
          begin={`${delay}s`}
          repeatCount="indefinite"
        />
      </rect>
    </g>
  );
}

export function EssenceParticles({ disabled = false }: { disabled?: boolean }): React.ReactElement | null {
  const reduced = useReducedMotion();
  if (disabled || reduced) return null;
  return (
    <svg
      className="absolute inset-0 h-full w-full pointer-events-none"
      viewBox="0 0 300 120"
      preserveAspectRatio="xMidYMid slice"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {PARTICLE_COLORS.map((color, i) => (
        <EssenceParticle
          key={i}
          x={20 + i * 28}
          color={color}
          dur={6 + (i % 4) * 2}
          delay={i * 0.7}
        />
      ))}
    </svg>
  );
}

/* ── 6. CTA DRAW-IN BORDER ── */

export function CtaBorderDraw({ disabled = false }: { disabled?: boolean }): React.ReactElement {
  const reduced = useReducedMotion();
  const animate = !disabled && !reduced;
  return (
    <div className="mb-6 w-full">
      <svg
        className="w-full"
        viewBox="0 0 600 8"
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        aria-hidden="true"
        style={{ height: "8px" }}
      >
        {/* Segments that draw in left-to-right */}
        {Array.from({ length: 75 }, (_, i) => (
          <rect
            key={i}
            x={i * 8}
            y="2"
            width="7"
            height="4"
            fill="#ffcc00"
            opacity={animate ? "0" : "0.8"}
          >
            {animate && (
              <animate
                attributeName="opacity"
                from="0"
                to="0.8"
                dur="0.05s"
                begin={`${i * 0.02}s`}
                fill="freeze"
              />
            )}
          </rect>
        ))}
        {/* After draw-in: traveling glow */}
        {animate && (
          <rect x="0" y="0" width="50" height="8" fill="#ffffff" opacity="0">
            <animate
              attributeName="opacity"
              values="0;0.15;0.15;0"
              keyTimes="0;0.1;0.9;1"
              dur="3s"
              begin="1.8s"
              repeatCount="indefinite"
            />
            <animateTransform
              attributeName="transform"
              type="translate"
              values="-50,0; 600,0"
              dur="3s"
              begin="1.8s"
              repeatCount="indefinite"
            />
          </rect>
        )}
      </svg>
    </div>
  );
}
