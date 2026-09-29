import { html } from "../html.ts";
import { oshiAccent } from "../oshiColor.ts";
import type { OshiSummary } from "../queries.ts";

export function layout(opts: {
  title: string;
  oshis: OshiSummary[];
  activeOshiId?: number;
  body: ReturnType<typeof html>;
  // Extra <head> content (resource hints, etc.) for pages that need more
  // than the defaults below - e.g. watch mode preloading YouTube's player.
  head?: ReturnType<typeof html>;
}): string {
  const { title, oshis, activeOshiId, body, head } = opts;

  const tabs = oshis.map(
    (o) => html`
      <a
        class="tab ${activeOshiId === o.id ? "tab--active" : ""}"
        href="/?oshi=${o.id}"
        style="--accent: ${oshiAccent(o.name)}"
      >
        <span class="tab__dot"></span>
        <span class="tab__name">${o.name}</span>
        <span class="tab__count">${o.watchedCount}/${o.clipCount}</span>
      </a>
    `,
  );

  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap"
    rel="stylesheet"
  />
  <link rel="stylesheet" href="/style.css" />
  <link rel="preconnect" href="https://i.ytimg.com" />
  <link rel="dns-prefetch" href="https://i.ytimg.com" />
  ${head ?? html``}
</head>
<body>
  <header class="shelf-header">
    <a class="wordmark" href="/">wtm</a>
    <nav class="tabs">
      <a class="tab ${activeOshiId == null ? "tab--active" : ""}" href="/">
        <span class="tab__dot tab__dot--all"></span>
        <span class="tab__name">All</span>
      </a>
      ${tabs}
    </nav>
    <nav class="manage-nav">
      <a class="manage-link" href="/stats">Progress</a>
      <a class="manage-link" href="/import">Import</a>
      <a class="manage-link" href="/jobs">Jobs</a>
      <a class="manage-link" href="/oshis">Oshis</a>
      <a class="manage-link" href="/tags">Tags</a>
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`.value;
}
