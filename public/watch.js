(() => {
  const feed = document.querySelector(".shorts-feed");
  if (!feed) return;

  // Raw postMessage("event":"command", ...) to a bare embed is unreliable -
  // the player only reacts to commands once handshaken via YouTube's own
  // IFrame Player API, which is why hand-rolled unMute/play calls silently
  // no-op. Load the real API and let it manage that handshake per player.
  let apiReady = false;
  const pendingInits = [];

  function whenApiReady(fn) {
    if (apiReady) fn();
    else pendingInits.push(fn);
  }

  if (window.YT && window.YT.Player) {
    apiReady = true;
  } else {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
      apiReady = true;
      pendingInits.splice(0).forEach((fn) => fn());
    };
  }

  // slide -> { player: YT.Player|null, wantsPlay } - wantsPlay lets a slide
  // reached by a fast swipe (before its own onReady has fired yet) start
  // playing the moment it's ready, instead of staying silently paused.
  //
  // Note: an earlier version of this file tried to reuse a small pool of
  // players across slides via cueVideoById/loadVideoById + reparenting the
  // iframe, to avoid rebuilding YouTube's player bootstrap per slide. That
  // triggered YouTube's own "An error occurred" player error in practice -
  // reparenting a live embed and rapidly re-cueing it isn't reliable enough
  // for this. One real iframe per slide is slower to spin up but correct.
  const state = new Map();

  function ensure(slide) {
    let entry = state.get(slide);
    if (entry) return entry;

    entry = { player: null, wantsPlay: false };
    state.set(slide, entry);

    const host = slide.querySelector(".shorts-slide__player");
    const videoId = slide.dataset.videoId;
    const iframe = document.createElement("iframe");
    // No autoplay=1/mute=1 in the URL - playback and mute state are driven
    // explicitly below, since a preloaded (not-yet-active) neighbor must
    // load without auto-starting its audio over the active slide's.
    iframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&playsinline=1`;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    host.appendChild(iframe);

    whenApiReady(() => {
      new YT.Player(iframe, {
        events: {
          onReady: (event) => {
            entry.player = event.target;
            if (entry.wantsPlay) activate(slide, entry.player);
          },
        },
      });
    });

    return entry;
  }

  // Opening this feed came from a click (a shelf card or a swipe), which is
  // exactly the user gesture Chrome's autoplay policy wants to see before
  // allowing unmuted autoplay. If it still gets muted anyway (some
  // browsers/contexts are stricter), fall back to a manual unmute button
  // instead of assuming sound always works.
  function activate(slide, player) {
    player.playVideo();
    setTimeout(() => {
      if (!player.isMuted()) return;
      const unmuteBtn = slide.querySelector(".shorts-slide__unmute");
      if (!unmuteBtn || !unmuteBtn.hidden) return;
      unmuteBtn.hidden = false;
      unmuteBtn.addEventListener(
        "click",
        () => {
          player.unMute();
          player.playVideo();
          unmuteBtn.hidden = true;
        },
        { once: true },
      );
    }, 400);
  }

  // Warm up a neighboring slide's player ahead of time so it's already
  // buffering by the time a swipe reaches it, without playing its audio yet.
  function preload(slide) {
    if (slide) ensure(slide);
  }

  function play(slide) {
    const entry = ensure(slide);
    entry.wantsPlay = true;
    if (entry.player) activate(slide, entry.player);
  }

  function pause(slide) {
    const entry = state.get(slide);
    if (!entry) return;
    entry.wantsPlay = false;
    entry.player?.pauseVideo();
  }

  const slides = [...feed.querySelectorAll(".shorts-slide[data-video-id]")];

  function activateAndPreloadNext(slide) {
    play(slide);
    preload(slides[slides.indexOf(slide) + 1]);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          activateAndPreloadNext(entry.target);
        } else {
          pause(entry.target);
        }
      }
    },
    { root: feed, threshold: 0.6 },
  );

  for (const slide of slides) observer.observe(slide);

  // Deep-link back into the slide a mutation (tag/takeaway) just happened on.
  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target) target.scrollIntoView({ block: "start" });
  }

  // Don't wait on the observer's first async tick for the slide already on
  // screen at load - start it immediately so playback isn't delayed.
  const initial = slides.find((s) => s.getBoundingClientRect().top < feed.clientHeight / 2) ?? slides[0];
  if (initial) activateAndPreloadNext(initial);

  // A raw wheel/trackpad gesture fires many events and, combined with
  // momentum + native scroll-snap, easily sails past several slides in one
  // swipe. Take scrolling over entirely: one gesture steps exactly one
  // slide, then input is locked out until that step's scroll settles -
  // matching how an actual Shorts feed feels rather than a free-scrolling
  // page that happens to have snap points.
  const allSlides = [...feed.querySelectorAll(".shorts-slide")];
  let stepLocked = false;

  function currentSlideIndex() {
    const idx = allSlides.findIndex((s) => {
      const rect = s.getBoundingClientRect();
      return rect.top >= -rect.height / 2 && rect.top < rect.height / 2;
    });
    return idx === -1 ? 0 : idx;
  }

  function step(delta) {
    if (stepLocked) return;
    const next = allSlides[currentSlideIndex() + delta];
    if (!next) return;
    stepLocked = true;
    next.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => {
      stepLocked = false;
    }, 700);
  }

  feed.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      step(event.deltaY > 0 ? 1 : -1);
    },
    { passive: false },
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    step(event.key === "ArrowDown" ? 1 : -1);
  });
})();
