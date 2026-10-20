import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { cssVar, weatherColors, type SeriesStyle } from './colors.js';
import { dayMonth, toUnix } from './format.js';

export interface LineSeries {
  label: string;
  values: (number | null)[];
  style: SeriesStyle;
}

const DAY = 86_400;

/** Shades the forecast part of the chart and labels it. */
function forecastPlugin(firstForecastX: number | null): uPlot.Plugin {
  return {
    hooks: {
      drawClear: (u) => {
        if (firstForecastX === null) return;
        const { ctx, bbox } = u;
        const x0 = u.valToPos(firstForecastX - DAY / 2, 'x', true);
        ctx.save();
        ctx.fillStyle = cssVar('--forecast');
        ctx.fillRect(x0, bbox.top, bbox.left + bbox.width - x0, bbox.height);
        ctx.fillStyle = cssVar('--muted');
        ctx.font = `${11 * devicePixelRatio}px system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText('Forecast', x0 + 4 * devicePixelRatio, bbox.top + 3 * devicePixelRatio);
        ctx.restore();
      },
    },
  };
}

/** One tooltip listing every visible series at the hovered day; values lead, labels follow. */
function tooltipPlugin(unit: string, dates: string[], forecastFrom: number): uPlot.Plugin {
  let tip: HTMLDivElement;
  return {
    hooks: {
      init: (u) => {
        tip = document.createElement('div');
        tip.className = 'chart-tip';
        tip.hidden = true;
        u.over.appendChild(tip);
      },
      setCursor: (u) => {
        const i = u.cursor.idx;
        if (i === null || i === undefined || u.cursor.left === undefined || u.cursor.left < 0) {
          tip.hidden = true;
          return;
        }
        tip.replaceChildren();
        const head = document.createElement('div');
        head.className = 'chart-tip-date';
        head.textContent = dayMonth(dates[i]!) + (i >= forecastFrom ? ' (forecast)' : '');
        tip.appendChild(head);
        u.series.forEach((s, si) => {
          if (si === 0 || !s.show) return;
          const v = u.data[si]![i];
          const row = document.createElement('div');
          row.className = 'chart-tip-row';
          const key = document.createElement('span');
          key.className = 'chart-tip-key';
          key.style.borderColor = String(
            s.stroke && typeof s.stroke === 'function' ? s.stroke(u, si) : s.stroke,
          );
          const val = document.createElement('strong');
          val.textContent =
            v === null || v === undefined ? '–' : `${Math.round(v * 10) / 10}${unit}`;
          const label = document.createElement('span');
          label.textContent = ` ${s.label}`;
          row.append(key, val, label);
          tip.appendChild(row);
        });
        tip.hidden = false;
        const left = u.cursor.left;
        const flip = left > u.over.clientWidth / 2;
        tip.style.left = flip ? '' : `${left + 12}px`;
        tip.style.right = flip ? `${u.over.clientWidth - left + 12}px` : '';
      },
    },
  };
}

function baseOpts(
  width: number,
  height: number,
  dates: string[],
  forecastFrom: number,
  unit: string,
  yRange: uPlot.Range.MinMax | undefined,
): uPlot.Options {
  const axis: uPlot.Axis = {
    stroke: cssVar('--muted'),
    grid: { stroke: cssVar('--grid'), width: 1 },
    ticks: { show: false },
    font: '11px system-ui, sans-serif',
  };
  return {
    width,
    height,
    legend: { show: false },
    cursor: { y: false, points: { size: 8 }, drag: { x: false, y: false } },
    scales: { x: { time: true }, y: yRange ? { range: yRange } : { auto: true } },
    axes: [
      {
        ...axis,
        grid: { show: false },
        values: (_u, vals) =>
          vals.map((v) => dayMonth(new Date(v * 1000).toISOString().slice(0, 10))),
      },
      { ...axis, size: 36, values: (_u, vals) => vals.map((v) => `${v}${unit}`) },
    ],
    series: [{}],
    plugins: [
      forecastPlugin(forecastFrom < dates.length ? toUnix(dates[forecastFrom]!) : null),
      tooltipPlugin(unit, dates, forecastFrom),
    ],
  };
}

/** Keeps a chart as wide as its container. Returns a cleanup function. */
function autoWidth(chart: uPlot, el: HTMLElement): () => void {
  const ro = new ResizeObserver(() =>
    chart.setSize({ width: el.clientWidth, height: chart.height }),
  );
  ro.observe(el);
  return () => {
    ro.disconnect();
    chart.destroy();
  };
}

/** Line chart of scores (0–100) per species. `forecastFrom` = index of the first forecast day. */
export interface VisitMarker {
  /** Index into `dates`. */
  index: number;
  found: boolean;
}

/** Find-log visits along the bottom of the chart: ▲ found, ✕ not found (shape, not only colour). */
function visitsPlugin(markers: VisitMarker[]): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        if (!markers.length) return;
        const { ctx, bbox } = u;
        const px = devicePixelRatio;
        ctx.save();
        ctx.font = `${13 * px}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (const m of markers) {
          const x = u.valToPos(u.data[0][m.index]!, 'x', true);
          ctx.fillStyle = m.found ? '#1a7837' : cssVar('--muted');
          ctx.fillText(m.found ? '▲' : '✕', x, bbox.top + bbox.height - 2 * px);
        }
        ctx.restore();
      },
    },
  };
}

export function scoreChart(
  el: HTMLElement,
  dates: string[],
  forecastFrom: number,
  series: LineSeries[],
  visible: Set<string>,
  visits: VisitMarker[] = [],
) {
  const opts = baseOpts(el.clientWidth, 200, dates, forecastFrom, '', [0, 100]);
  opts.plugins!.push(visitsPlugin(visits));
  opts.series.push(
    ...series.map((s) => ({
      label: s.label,
      stroke: s.style.color,
      width: 2,
      ...(s.style.dash ? { dash: s.style.dash } : {}),
      show: visible.has(s.label),
      points: { show: false },
      spanGaps: false,
    })),
  );
  const chart = new uPlot(
    opts,
    [dates.map(toUnix), ...series.map((s) => s.values)] as uPlot.AlignedData,
    el,
  );
  return { chart, destroy: autoWidth(chart, el) };
}

/** Daily rain bars (mm). */
export function rainChart(
  el: HTMLElement,
  dates: string[],
  forecastFrom: number,
  precip: (number | null)[],
) {
  const c = weatherColors();
  const opts = baseOpts(el.clientWidth, 120, dates, forecastFrom, ' mm', undefined);
  opts.scales!.y = { range: (_u, _min, max) => [0, Math.max(10, Math.ceil(max / 5) * 5)] };
  opts.series.push({
    label: 'Rain',
    stroke: c.rain,
    fill: c.rain,
    width: 0,
    paths: uPlot.paths.bars!({ size: [0.6, 24], radius: 0.25 }),
    points: { show: false },
  });
  const chart = new uPlot(opts, [dates.map(toUnix), precip] as uPlot.AlignedData, el);
  return { chart, destroy: autoWidth(chart, el) };
}

/** Daily min and max temperature (°C), one axis. */
export function tempChart(
  el: HTMLElement,
  dates: string[],
  forecastFrom: number,
  tmin: (number | null)[],
  tmax: (number | null)[],
) {
  const c = weatherColors();
  const opts = baseOpts(el.clientWidth, 120, dates, forecastFrom, '°', undefined);
  opts.series.push(
    { label: 'Max', stroke: c.tmax, width: 2, points: { show: false } },
    { label: 'Min', stroke: c.tmin, width: 2, points: { show: false } },
  );
  const chart = new uPlot(opts, [dates.map(toUnix), tmax, tmin] as uPlot.AlignedData, el);
  return { chart, destroy: autoWidth(chart, el) };
}
