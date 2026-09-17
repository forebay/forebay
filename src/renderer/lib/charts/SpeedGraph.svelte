<script lang="ts">
  import type { JobSample } from "@forebay/shared";
  import { linePath, niceMax, type Pt } from "./chartMath.js";
  import { formatRate } from "@forebay/shared";

  // A live transfer trace. Unlike AreaChart this has no labelled columns and no hover: the
  // x axis is just "recently", so the shape and the current figure are the whole story.
  let {
    samples,
    height = 56,
    label = "",
  }: { samples: JobSample[]; height?: number; label?: string } = $props();

  const WIDTH = 560;
  const PAD = 3;

  const values = $derived(samples.map((s) => s.bytesPerSecond));
  const max = $derived(niceMax(Math.max(...values, 1)));
  const peak = $derived(Math.max(...values, 0));
  const current = $derived(values.length > 0 ? values[values.length - 1] : 0);

  const points = $derived.by<Pt[]>(() => {
    if (values.length === 0) return [];
    const innerW = WIDTH - PAD * 2;
    const innerH = height - PAD * 2;
    // A single reading has no line to draw, so hold it flat across the width.
    if (values.length === 1) {
      const y = PAD + innerH - (values[0] / max) * innerH;
      return [{ x: PAD, y }, { x: WIDTH - PAD, y }];
    }
    return values.map((value, i) => ({
      x: PAD + (innerW * i) / (values.length - 1),
      y: PAD + innerH - (value / max) * innerH,
    }));
  });

  const trace = $derived(linePath(points));
  const fill = $derived(
    points.length > 0
      ? `${trace} L ${WIDTH - PAD} ${height - PAD} L ${PAD} ${height - PAD} Z`
      : "",
  );
</script>

<div class="graph" style={`--h:${height}px`}>
  {#if points.length === 0}
    <p class="idle">waiting for transfer</p>
  {:else}
    <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${label} transfer rate, currently ${formatRate(current)}`}>
      <defs>
        <linearGradient id="speedfade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path class="fill" d={fill} />
      <path class="trace" d={trace} />
      <circle class="head" cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2.5" />
    </svg>
    <div class="readout">
      <span class="now">{formatRate(current)}</span>
      <span class="peak">peak {formatRate(peak)}</span>
    </div>
  {/if}
</div>

<style>
  .graph {
    position: relative;
  }
  svg {
    display: block;
    width: 100%;
    height: var(--h);
  }
  .fill {
    fill: url(#speedfade);
  }
  .trace {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .head {
    fill: var(--accent);
  }
  .readout {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
  }
  .now {
    font-size: 13px;
    color: var(--text);
  }
  .peak,
  .idle {
    font-size: 10.5px;
    color: var(--faint);
  }
  .idle {
    margin: 0;
    height: var(--h);
    display: flex;
    align-items: center;
    font-family: var(--mono);
  }
</style>
