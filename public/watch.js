(() => {
  const feed = document.querySelector(".feed");
  if (!feed) return;

  const data = JSON.parse(document.getElementById("feed-data").textContent);
  let queue = data.queue; // [{ id, videoId, kind, title }]
  let filters = data.filters;
  let cur = data.start;

  const stage = feed.querySelector(".feed__stage");
  const track = feed.querySelector(".feed__track");
  const panel = feed.querySelector(".feed__panel");
  const posEl = feed.querySelector(".queue-bar__pos");
  const filterDetails = feed.querySelector(".queue-filter");
  const filterForm = feed.querySelector(".queue-filter__form");
  const upNext = feed.querySelector(".up-next");
  const upNextList = feed.querySelector(".up-next__list");
  const closeLink = document.querySelector(".watch-overlay__close");
  const endPanel = document.getElementById("feed-end-panel");
  const peek = feed.querySelector(".feed__peek");
  const peekPos = feed.querySelector(".feed__peek-pos");
  const peekTitle = feed.querySelector(".feed__peek-title");
  const scrim = feed.querySelector(".feed__scrim");
  const sheetGrab = feed.querySelector(".feed__sheet-grab");

  // Virtualization: the queue can be 1000+ clips, but only slides within
  // SLIDE_RADIUS of the current one exist in the DOM (as thumbnails), and
  // only those within PLAYER_RADIUS get a real YouTube iframe - so at most
  // 3 players are ever alive. Everything further away is torn down, which
  // is what actually frees the memory an embed holds.
  const SLIDE_RADIUS = 2;
  const PLAYER_RADIUS = 1;
  const UP_NEXT_COUNT = 6;

  function qs() {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  function thumb(videoId) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  // ---- YouTube IFrame API ----
  //
  // Raw postMessage("event":"command", ...) to a bare embed is unreliable -
  // the player only reacts to commands once handshaken via YouTube's own
  // IFrame Player API. Load the real API and let it manage that per player.
  let apiReady = !!(window.YT && window.YT.Player);
  const pendingInits = [];

  function whenApiReady(fn) {
    if (apiReady) fn();
    else pendingInits.push(fn);
  }

  if (!apiReady) {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
      apiReady = true;
      pendingInits.splice(0).forEach((fn) => fn());
    };
  }

  // ---- slides ----
  //
  // key ("end" or a clip id) -> { key, el, frame, unmuteBtn, iframe, player, wantsPlay }
  //
  // Each slide owns its own iframe for as long as it's mounted. An earlier
  // version reused a small pool of players via cueVideoById + reparenting
  // the iframe, which triggered YouTube's own "An error occurred" player
  // error in practice - so players are created/destroyed, never moved.
  const slides = new Map();

  function keyAt(i) {
    return i === queue.length ? "end" : queue[i].id;
  }

  function createSlide(i) {
    const el = document.createElement("section");
    el.className = "feed-slide";

    if (i === queue.length) {
      el.classList.add("feed-slide--end");
      el.innerHTML = `<p>That's all for this queue.</p><p>Use <b>filter up next</b> to keep going.</p>`;
      return { key: "end", el };
    }

    const item = queue[i];
    el.classList.add(`feed-slide--${item.kind}`);
    el.innerHTML = `
      <div class="feed-slide__box">
        <div class="feed-slide__frame">
          <img alt="" loading="lazy" />
          <button type="button" class="feed-slide__unmute" hidden>unmute</button>
        </div>
      </div>`;
    el.querySelector("img").src = thumb(item.videoId);
    return {
      key: item.id,
      videoId: item.videoId,
      el,
      frame: el.querySelector(".feed-slide__frame"),
      unmuteBtn: el.querySelector(".feed-slide__unmute"),
      iframe: null,
      player: null,
      wantsPlay: false,
    };
  }

  function renderSlides(center) {
    track.style.setProperty("--n", queue.length + 1);
    const keep = new Set();
    for (let i = center - SLIDE_RADIUS; i <= center + SLIDE_RADIUS; i++) {
      if (i < 0 || i > queue.length) continue;
      const key = keyAt(i);
      keep.add(key);
      let slide = slides.get(key);
      if (!slide) {
        slide = createSlide(i);
        slides.set(key, slide);
        track.appendChild(slide.el);
      }
      slide.el.style.setProperty("--i", i);
    }
    for (const [key, slide] of slides) {
      if (keep.has(key)) continue;
      unmountPlayer(slide);
      slide.el.remove();
      slides.delete(key);
    }
  }

  function syncPlayers(center) {
    for (let i = center - SLIDE_RADIUS; i <= center + SLIDE_RADIUS; i++) {
      if (i < 0 || i >= queue.length) continue;
      const slide = slides.get(keyAt(i));
      if (!slide) continue;
      if (Math.abs(i - center) <= PLAYER_RADIUS) mountPlayer(slide);
      else unmountPlayer(slide);
    }
  }

  function mountPlayer(slide) {
    if (slide.iframe) return;
    const iframe = document.createElement("iframe");
    // No autoplay=1/mute=1 in the URL - playback is driven explicitly below,
    // since a preloaded (not-yet-current) neighbor must load without
    // starting its audio over the current slide's.
    iframe.src = `https://www.youtube.com/embed/${slide.videoId}?enablejsapi=1&playsinline=1&rel=0`;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    slide.frame.appendChild(iframe);
    slide.iframe = iframe;

    whenApiReady(() => {
      if (slide.iframe !== iframe) return; // unmounted before the API loaded
      new YT.Player(iframe, {
        events: {
          onReady: (event) => {
            if (slide.iframe !== iframe) return;
            slide.player = event.target;
            if (slide.wantsPlay) activate(slide);
          },
          // Auto-advance: a clip finishing moves the feed on to the next
          // one, the same as a swipe would.
          onStateChange: (event) => {
            if (event.data !== YT.PlayerState.ENDED) return;
            if (slide.iframe !== iframe || cur >= queue.length || keyAt(cur) !== slide.key) return;
            goTo(cur + 1, true);
          },
        },
      });
    });
  }

  function unmountPlayer(slide) {
    if (!slide.iframe) return;
    try {
      slide.player?.destroy();
    } catch {}
    slide.iframe.remove();
    slide.iframe = null;
    slide.player = null;
    slide.wantsPlay = false;
    slide.unmuteBtn.hidden = true;
  }

  // Entering watch mode came from a click, which is the user gesture
  // Chrome's autoplay policy wants before allowing unmuted autoplay. If it
  // still gets muted (stricter browsers/contexts), offer a manual unmute.
  function activate(slide) {
    const player = slide.player;
    player.playVideo();
    setTimeout(() => {
      if (slide.player !== player || !slide.wantsPlay || !player.isMuted()) return;
      slide.unmuteBtn.hidden = false;
      slide.unmuteBtn.onclick = () => {
        player.unMute();
        player.playVideo();
        slide.unmuteBtn.hidden = true;
      };
    }, 400);
  }

  function play(slide) {
    if (!slide || slide.key === "end") return;
    mountPlayer(slide);
    slide.wantsPlay = true;
    if (slide.player) activate(slide);
  }

  function pause(slide) {
    if (!slide || slide.key === "end") return;
    slide.wantsPlay = false;
    slide.player?.pauseVideo();
  }

  // ---- current clip ----

  function setCurrent(index, force = false) {
    index = Math.max(0, Math.min(index, queue.length));
    if (index === cur && !force) return;
    const prevKey = cur <= queue.length ? keyAt(cur) : null;
    if (prevKey != null && prevKey !== keyAt(index)) pause(slides.get(prevKey));
    cur = index;
    renderSlides(cur);
    syncPlayers(cur);
    play(slides.get(keyAt(cur)));
    updateChrome();
    loadPanel();
  }

  function updateChrome() {
    posEl.textContent = `${Math.min(cur + 1, queue.length)} / ${queue.length}`;
    peekPos.textContent = posEl.textContent;
    peekTitle.textContent = cur < queue.length ? queue[cur].title : "End of queue";
    if (closeLink) closeLink.href = `/${qs()}`;
    if (cur < queue.length) {
      history.replaceState(null, "", `/watch/${queue[cur].id}${qs()}`);
      document.title = queue[cur].title;
      filterForm.action = `/watch/${queue[cur].id}`;
    }
    renderUpNext();
  }

  function renderUpNext() {
    const next = queue.slice(cur + 1, cur + 1 + UP_NEXT_COUNT);
    upNext.hidden = next.length === 0;
    upNextList.replaceChildren(
      ...next.map((item, offset) => {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `up-next__item up-next__item--${item.kind}`;
        const img = document.createElement("img");
        img.src = thumb(item.videoId);
        img.alt = "";
        img.loading = "lazy";
        const title = document.createElement("span");
        title.className = "up-next__title";
        title.textContent = item.title;
        btn.append(img, title);
        btn.addEventListener("click", () => goTo(cur + 1 + offset, false));
        li.appendChild(btn);
        return li;
      }),
    );
    const remaining = queue.length - (cur + 1 + next.length);
    if (remaining > 0) {
      const li = document.createElement("li");
      li.className = "up-next__more";
      li.textContent = `+ ${remaining} more`;
      upNextList.appendChild(li);
    }
  }

  let panelToken = 0;
  async function loadPanel() {
    const token = ++panelToken;
    if (cur >= queue.length) {
      panel.replaceChildren(endPanel.content.cloneNode(true));
      return;
    }
    panel.classList.add("feed__panel--loading");
    try {
      const res = await fetch(`/clips/${queue[cur].id}/panel${qs()}`);
      const markup = await res.text();
      if (token !== panelToken) return;
      // Server-rendered through the same auto-escaping html`` helper as
      // every other page, so it's safe to inject as-is.
      panel.innerHTML = markup;
    } finally {
      if (token === panelToken) panel.classList.remove("feed__panel--loading");
    }
  }

  // Tag/takeaway forms post in the background and re-render only the
  // panel, so the clip keeps playing instead of the page reloading.
  panel.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const button = form.querySelector("button[type=submit], button:not([type])");
    if (button) button.disabled = true;
    try {
      await fetch(form.action, {
        method: "POST",
        body: new URLSearchParams(new FormData(form)),
        headers: { "x-wtm-fetch": "1" },
      });
    } finally {
      await loadPanel();
    }
  });

  // ---- scrolling ----
  //
  // The stage is a native scroll container with scroll-snap-stop: always,
  // so one gesture moves exactly one slide - including a wheel/swipe over
  // the YouTube iframe itself, whose events never reach this page's JS but
  // do chain into this scroller natively.

  function slideHeight() {
    return stage.clientHeight || 1;
  }

  function indexFromScroll() {
    return Math.round(stage.scrollTop / slideHeight());
  }

  // Set while a programmatic smooth scroll is in flight, so the debounced
  // settle doesn't snap "current" back to wherever the animation is midway.
  let scrollTarget = null;

  function goTo(index, smooth) {
    index = Math.max(0, Math.min(index, queue.length));
    // The target must exist as a snap area before scrolling, or the browser
    // snaps back to whichever rendered slide is nearest.
    renderSlides(index);
    scrollTarget = smooth ? index : null;
    stage.scrollTo({ top: index * slideHeight(), behavior: smooth ? "smooth" : "instant" });
    setCurrent(index);
  }

  let settleTimer;
  function settle(event) {
    clearTimeout(settleTimer);
    const index = indexFromScroll();
    if (scrollTarget != null) {
      // scrollend also fires when the animation gets interrupted, at which
      // point wherever it stopped wins.
      if (index !== scrollTarget && event?.type !== "scrollend") return;
      scrollTarget = null;
    }
    setCurrent(index);
  }

  stage.addEventListener(
    "scroll",
    () => {
      // Keep thumbnails ahead of wherever the scroll currently is, but only
      // swap players once it has come to rest on a slide.
      renderSlides(indexFromScroll());
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, 180);
    },
    { passive: true },
  );
  if ("onscrollend" in window) stage.addEventListener("scrollend", settle);

  new ResizeObserver(() => {
    stage.scrollTo({ top: cur * slideHeight(), behavior: "instant" });
  }).observe(stage);

  // ---- portrait bottom sheet ----
  //
  // On wide screens the sidebar is always visible and none of this shows;
  // in portrait it's a sheet over the stage, opened from the peek bar.
  function setSheet(open) {
    feed.classList.toggle("feed--sheet-open", open);
    peek.setAttribute("aria-expanded", String(open));
    scrim.hidden = !open;
  }

  peek.addEventListener("click", () => setSheet(true));
  scrim.addEventListener("click", () => setSheet(false));
  sheetGrab.addEventListener("click", () => setSheet(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && feed.classList.contains("feed--sheet-open")) {
      setSheet(false);
      return;
    }
    if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    const down = event.key === "ArrowDown" || event.key === "j";
    const up = event.key === "ArrowUp" || event.key === "k";
    if (!down && !up) return;
    event.preventDefault();
    goTo(cur + (down ? 1 : -1), true);
  });

  // ---- filter up next ----
  //
  // Everything up to and including the current clip stays put (so you can
  // still scroll back through what you've seen); everything after it is
  // replaced by the freshly filtered queue.
  filterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = {};
    for (const [k, v] of new FormData(filterForm)) if (v) next[k] = String(v);
    if (next.order === "random") next.seed = String(Math.floor(Math.random() * 1e9));

    const button = filterForm.querySelector("button");
    button.disabled = true;
    try {
      const params = new URLSearchParams(next).toString();
      const fresh = await (await fetch(`/api/queue?${params}`)).json();
      const wasAtEnd = cur >= queue.length;
      const head = queue.slice(0, cur + (wasAtEnd ? 0 : 1));
      const seen = new Set(head.map((item) => item.id));
      // The end slide is keyed "end", not by index - drop it so it gets
      // rebuilt at its new position.
      const endSlide = slides.get("end");
      if (endSlide) {
        endSlide.el.remove();
        slides.delete("end");
      }
      queue = head.concat(fresh.filter((item) => !seen.has(item.id)));
      filters = next;
      filterDetails.open = false;
      if (wasAtEnd) {
        setCurrent(cur, true);
      } else {
        renderSlides(cur);
        syncPlayers(cur);
        updateChrome();
      }
    } finally {
      button.disabled = false;
    }
  });

  // ---- boot ----
  renderSlides(cur);
  stage.scrollTo({ top: cur * slideHeight(), behavior: "instant" });
  syncPlayers(cur);
  play(slides.get(keyAt(cur)));
  updateChrome(); // first panel is already server-rendered
})();
