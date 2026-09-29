import { html } from "../html.ts";
import { oshiAccent } from "../oshiColor.ts";
import type { OshiSummary, TagProgress, OverallProgress, HeatmapDay } from "../queries.ts";

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function barRow(label: string, watched: number, total: number, accent?: string) {
  const p = pct(watched, total);
  return html`
    <div class="bar-row">
      <span class="bar-row__label">${label}</span>
      <span class="bar-row__track">
        <span class="bar-row__fill" style="width: ${p}%; ${accent ? `--accent: ${accent}` : ""}"></span>
      </span>
      <span class="bar-row__count">${watched}/${total} (${p}%)</span>
    </div>
  `;
}

function heatmapLevel(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function buildHeatmapCells(days: HeatmapDay[], weeks: number): { date: string; count: number }[] {
  const counts = new Map(days.map((d) => [d.day, d.count]));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (weeks * 7 - 1));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // pad back to a Sunday

  const cells: { date: string; count: number }[] = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const iso = cursor.toISOString().slice(0, 10);
    cells.push({ date: iso, count: counts.get(iso) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cells;
}

function heatmap(days: HeatmapDay[]) {
  const cells = buildHeatmapCells(days, 20);
  return html`
    <div class="heatmap">
      ${cells.map(
        (c) => html`
          <span class="heatmap__cell" style="--level: ${heatmapLevel(c.count)}" title="${c.date}: ${c.count} watched"></span>
        `,
      )}
    </div>
  `;
}

export function statsPage(opts: {
  overall: OverallProgress;
  oshis: OshiSummary[];
  tagProgress: TagProgress[];
  heatmapDays: HeatmapDay[];
  oshiBreakdowns: Map<number, TagProgress[]>;
}) {
  const { overall, oshis, tagProgress, heatmapDays, oshiBreakdowns } = opts;

  return html`
    <a class="back" href="/">&larr; back to shelf</a>
    <h1 class="heading">Progress</h1>

    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-card__value">${overall.watchedClips}</span>
        <span class="stat-card__label">watched</span>
      </div>
      <div class="stat-card">
        <span class="stat-card__value">${overall.totalClips}</span>
        <span class="stat-card__label">total clips</span>
      </div>
      <div class="stat-card">
        <span class="stat-card__value">${pct(overall.watchedClips, overall.totalClips)}%</span>
        <span class="stat-card__label">complete</span>
      </div>
    </div>

    <section>
      <h2 class="heading heading--sub">Activity</h2>
      ${heatmap(heatmapDays)}
    </section>

    <section>
      <h2 class="heading heading--sub">By oshi</h2>
      <div class="bar-list">
        ${oshis.map((o) => barRow(o.name, o.watchedCount, o.clipCount, oshiAccent(o.name)))}
      </div>
    </section>

    <section>
      <h2 class="heading heading--sub">By tag</h2>
      <div class="bar-list">
        ${tagProgress.map((t) => barRow(t.name, t.watchedCount, t.clipCount))}
      </div>
    </section>

    <section>
      <h2 class="heading heading--sub">Oshi drilldown</h2>
      <div class="accordion">
        ${oshis.map(
          (o) => html`
            <details>
              <summary>${o.name} <span class="accordion__count">${o.watchedCount}/${o.clipCount}</span></summary>
              <div class="bar-list">
                ${(oshiBreakdowns.get(o.id) ?? [])
                  .filter((t) => t.clipCount > 0)
                  .map((t) => barRow(t.name, t.watchedCount, t.clipCount))}
              </div>
            </details>
          `,
        )}
      </div>
    </section>
  `;
}
