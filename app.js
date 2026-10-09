// Anime Primer: app logic. Vanilla JS, hash routing, localStorage persistence.
(() => {
  const UNITS = window.UNITS;
  const ALL = UNITS.flatMap(u => u.cards.map(c => ({ ...c, unit: u.id })));
  const BY_ID = Object.fromEntries(ALL.map(c => [c.id, c]));
  const KEY = "animePrimer.v1";
  const SESSION_SIZE = 10;
  const MASTERED = 2; // correct answers (any mode, any time) for a card to count as mastered
  const credit = id => Math.min(stat(id).right, MASTERED);
  const isMastered = id => credit(id) >= MASTERED;

  // ---------- persistence ----------
  const fresh = () => ({ cards: {}, read: {}, history: [], settings: { scope: "all", flip: "term", theme: null } });
  let state = load();

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.cards) return { ...fresh(), ...s, settings: { ...fresh().settings, ...s.settings } };
    } catch (e) {}
    return fresh();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  const stat = id => state.cards[id] || { box: 0, right: 0, wrong: 0, last: 0 };

  function record(id, ok, mode) {
    const s = { ...stat(id) };
    s.prevBox = s.box;
    s.box = ok ? Math.min(5, s.box + 1) : 1;
    ok ? s.right++ : s.wrong++;
    s.last = Date.now();
    state.cards[id] = s;
    state.history.unshift({ t: s.last, id, ok, mode });
    state.history = state.history.slice(0, 300);
    save();
  }
  // Undo the most recent record for a card (used by "count it as correct" override).
  function overrideLast(id) {
    const h = state.history[0];
    if (!h || h.id !== id || h.ok) return;
    const s = state.cards[id];
    s.wrong--; s.right++;
    s.box = Math.min(5, (s.prevBox ?? 0) + 1);
    h.ok = true;
    save();
  }

  // ---------- helpers ----------
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const md = s => esc(s).replace(/\*(.+?)\*/g, "<i>$1</i>");
  const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const unitOf = id => UNITS.find(u => u.id === id);
  const pool = () => state.settings.scope === "all" ? ALL : ALL.filter(c => c.unit === state.settings.scope);
  const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function redact(text, card) {
    let out = text;
    for (const w of [card.term, ...(card.alt || [])].sort((a, b) => b.length - a.length)) {
      const bare = w.replace(/^-/, "");
      if (bare.length < 2) continue;
      out = out.replace(new RegExp(`(?<![\\p{L}])-?${reEsc(bare)}(?![\\p{L}])`, "giu"), "＿＿＿");
    }
    return out;
  }

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // Pick a study session: unmastered cards first, then weakest boxes, then least-recently seen, random tiebreak.
  function pickSession(n = SESSION_SIZE) {
    const p = pool().map(c => ({ c, s: stat(c.id), r: Math.random() }));
    p.sort((a, b) => credit(a.c.id) - credit(b.c.id) || a.s.box - b.s.box || a.s.last - b.s.last || a.r - b.r);
    return shuffle(p.slice(0, n).map(x => x.c));
  }

  function unitProgress(u) {
    const total = u.cards.length;
    const mastered = u.cards.filter(c => isMastered(c.id)).length;
    const seen = u.cards.filter(c => stat(c.id).last).length;
    return { total, mastered, seen, pct: masteryPct(u.cards) };
  }
  // Partial credit: each correct answer counts, up to MASTERED per card.
  function masteryPct(cards) {
    const pts = cards.reduce((a, c) => a + credit(c.id), 0);
    return Math.round(pts / (cards.length * MASTERED) * 100);
  }
  function overall() {
    const vals = ALL.map(c => stat(c.id));
    const right = vals.reduce((a, s) => a + s.right, 0), wrong = vals.reduce((a, s) => a + s.wrong, 0);
    return {
      total: ALL.length,
      mastered: ALL.filter(c => isMastered(c.id)).length,
      pct: masteryPct(ALL),
      seen: vals.filter(s => s.last).length,
      answered: right + wrong,
      acc: right + wrong ? Math.round(right / (right + wrong) * 100) : null,
      read: Object.keys(state.read).length
    };
  }

  const boxBadge = id => {
    const s = stat(id);
    const [cls, label] = isMastered(id) ? ["badge-success", "mastered"] : s.right ? ["badge-info", "learning"] : s.wrong ? ["badge-warning", "review"] : ["badge-ghost", "new"];
    return `<span class="badge badge-sm ${cls}">${label}</span>`;
  };

  function scopePicker() {
    const opts = [`<option value="all">All units (${ALL.length} cards)</option>`]
      .concat(UNITS.map(u => `<option value="${u.id}" ${state.settings.scope === u.id ? "selected" : ""}>${u.icon} ${esc(u.title)} (${u.cards.length})</option>`));
    return `<select id="scope" class="select select-bordered select-sm w-full max-w-xs">${opts.join("")}</select>`;
  }
  function bindScope(rerender) {
    const el = $("#scope");
    if (el) el.onchange = e => { state.settings.scope = e.target.value; save(); rerender(); };
  }

  // ---------- views ----------
  const app = () => $("#app");
  let keyHandler = null;
  const onKey = fn => { keyHandler = fn; };
  document.addEventListener("keydown", e => {
    if (keyHandler && !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) keyHandler(e);
  });

  function viewHome() {
    const o = overall();
    app().innerHTML = `
      <section class="hero rounded-box bg-base-100 border border-base-300 mb-8">
        <div class="hero-content text-center py-10">
          <div class="max-w-xl">
            <h1 class="text-3xl md:text-4xl font-bold">Anime Primer <span class="opacity-60 font-normal">アニメ入門</span></h1>
            <p class="py-4 opacity-80">Genres, archetypes, tropes and cultural touchpoints, written for a dubbing adapter coming from live-action. Read a unit, then drill it.</p>
            <div class="flex flex-wrap gap-2 justify-center">
              <a href="#/flash" class="btn btn-primary">Flashcards</a>
              <a href="#/quiz" class="btn btn-secondary">Multiple choice</a>
              <a href="#/type" class="btn btn-accent">Type the answer</a>
            </div>
          </div>
        </div>
      </section>
      <div class="stats stats-vertical sm:stats-horizontal shadow w-full mb-8 bg-base-100">
        <div class="stat"><div class="stat-title">Mastered</div><div class="stat-value text-primary">${o.mastered}<span class="text-lg opacity-50">/${o.total}</span></div><div class="stat-desc">${o.pct}% overall mastery</div></div>
        <div class="stat"><div class="stat-title">Units read</div><div class="stat-value">${o.read}<span class="text-lg opacity-50">/${UNITS.length}</span></div></div>
        <div class="stat"><div class="stat-title">Accuracy</div><div class="stat-value">${o.acc ?? "—"}${o.acc != null ? "%" : ""}</div><div class="stat-desc">${o.answered} answers</div></div>
      </div>
      <h2 class="text-xl font-semibold mb-4">Units</h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${UNITS.map(u => { const p = unitProgress(u); return `
          <a href="#/learn/${u.id}" class="card bg-base-100 shadow hover:shadow-lg transition border border-base-300">
            <div class="card-body p-5">
              <div class="flex items-start justify-between gap-2">
                <h3 class="card-title text-lg"><span class="text-2xl">${u.icon}</span> ${esc(u.title)}</h3>
                ${state.read[u.id] ? '<span class="badge badge-success badge-sm shrink-0">read</span>' : ""}
              </div>
              <p class="text-sm opacity-75">${esc(u.summary)}</p>
              <progress class="progress progress-primary w-full mt-2" value="${p.pct}" max="100"></progress>
              <p class="text-xs opacity-60">${p.pct}% · ${p.mastered}/${p.total} mastered · ${p.seen} seen</p>
            </div>
          </a>`; }).join("")}
      </div>`;
  }

  function viewUnit(id) {
    const u = unitOf(id);
    if (!u) return viewHome();
    const i = UNITS.indexOf(u), prev = UNITS[i - 1], next = UNITS[i + 1];
    app().innerHTML = `
      <div class="text-sm breadcrumbs mb-2"><ul><li><a href="#/">Home</a></li><li>${esc(u.title)}</li></ul></div>
      <h1 class="text-3xl font-bold mb-2">${u.icon} ${esc(u.title)}</h1>
      <p class="opacity-75 mb-6">${esc(u.summary)}</p>
      <div class="prose max-w-none mb-6">${u.intro.map(p => `<p>${p}</p>`).join("")}</div>
      <div class="flex flex-wrap gap-2 mb-8">
        <button id="markread" class="btn btn-sm ${state.read[u.id] ? "btn-success" : "btn-outline"}">${state.read[u.id] ? "✓ Read" : "Mark as read"}</button>
        <button data-go="flash" class="btn btn-sm btn-primary">Flashcards for this unit</button>
        <button data-go="quiz" class="btn btn-sm btn-secondary">Quiz this unit</button>
        <button data-go="type" class="btn btn-sm btn-accent">Type-it for this unit</button>
      </div>
      <h2 class="text-xl font-semibold mb-3">Key terms</h2>
      <div class="space-y-3 mb-10">
        ${u.cards.map(c => `
          <div class="collapse collapse-arrow bg-base-100 border border-base-300">
            <input type="checkbox" />
            <div class="collapse-title flex items-center gap-3 flex-wrap">
              <span class="font-semibold">${esc(c.term)}</span>
              ${c.jp ? `<span class="opacity-60 jp">${esc(c.jp)}</span>` : ""}
              ${boxBadge(c.id)}
            </div>
            <div class="collapse-content space-y-3">
              <p>${esc(c.def)}</p>
              ${c.note ? `<div class="alert alert-info py-2 text-sm items-start"><span>🎙️</span><span><b>Adapter's note:</b> ${esc(c.note)}</span></div>` : ""}
              ${c.ex ? `<p class="text-sm opacity-75"><b>Examples:</b> ${esc(c.ex)}</p>` : ""}
              <a class="link link-hover text-xs opacity-60" target="_blank" rel="noopener" href="https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(c.term + " anime")}">Search Wikipedia ↗</a>
            </div>
          </div>`).join("")}
      </div>
      <h2 class="text-xl font-semibold mb-3">Sources & further reading</h2>
      <ul class="list-disc pl-6 space-y-1 mb-10 text-sm">
        ${u.sources.map(s => `<li>${s.url ? `<a class="link link-primary" target="_blank" rel="noopener" href="${esc(s.url)}">${md(s.label)}</a>` : md(s.label)}</li>`).join("")}
      </ul>
      <div class="flex justify-between">
        ${prev ? `<a class="btn btn-ghost" href="#/learn/${prev.id}">← ${esc(prev.title)}</a>` : "<span></span>"}
        ${next ? `<a class="btn btn-ghost" href="#/learn/${next.id}">${esc(next.title)} →</a>` : ""}
      </div>`;
    $("#markread").onclick = () => {
      if (state.read[u.id]) delete state.read[u.id]; else state.read[u.id] = Date.now();
      save(); viewUnit(id);
    };
    app().querySelectorAll("[data-go]").forEach(b => b.onclick = () => {
      state.settings.scope = u.id; save(); location.hash = "#/" + b.dataset.go;
    });
  }

  // Shared session shell for the three practice modes.
  function practiceShell(title, desc, extra = "") {
    return `
      <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
        <div><h1 class="text-2xl font-bold">${title}</h1><p class="opacity-70 text-sm">${desc}</p></div>
        <div class="flex gap-2 items-center flex-wrap">${extra}${scopePicker()}</div>
      </div>
      <div id="stage"></div>`;
  }

  function summary(results, again) {
    const right = results.filter(r => r.ok).length;
    const missed = results.filter(r => !r.ok).map(r => BY_ID[r.id]);
    $("#stage").innerHTML = `
      <div class="card bg-base-100 shadow border border-base-300 max-w-xl mx-auto">
        <div class="card-body items-center text-center">
          <div class="radial-progress text-primary" style="--value:${Math.round(right / results.length * 100)};--size:6rem">${right}/${results.length}</div>
          <h2 class="card-title mt-2">${right === results.length ? "Perfect round! 🎉" : "Round complete"}</h2>
          ${missed.length ? `<div class="text-left w-full mt-2"><p class="font-semibold text-sm mb-1">Review these:</p><ul class="text-sm space-y-1">${missed.map(c => `<li><a class="link" href="#/learn/${c.unit}">${esc(c.term)}</a>: <span class="opacity-70">${esc(c.def.slice(0, 90))}…</span></li>`).join("")}</ul></div>` : ""}
          <div class="card-actions mt-4"><button id="again" class="btn btn-primary">Next round</button><a href="#/progress" class="btn btn-ghost">Progress</a></div>
        </div>
      </div>`;
    $("#again").onclick = again;
    onKey(e => { if (e.key === "Enter") again(); });
  }

  const counter = (i, n) => `<div class="flex items-center gap-3 mb-4 max-w-xl mx-auto"><progress class="progress progress-primary" value="${i}" max="${n}"></progress><span class="text-sm opacity-60 whitespace-nowrap">${i + 1} / ${n}</span></div>`;

  // --- Flashcards ---
  function viewFlash() {
    const flipFront = state.settings.flip;
    app().innerHTML = practiceShell("Flashcards", "Flip the card, then grade yourself honestly. Missed cards come back sooner. Keys: Space flips, 1 = again, 2 = got it.",
      `<select id="flipdir" class="select select-bordered select-sm"><option value="term" ${flipFront === "term" ? "selected" : ""}>Term → meaning</option><option value="def" ${flipFront === "def" ? "selected" : ""}>Meaning → term</option></select>`);
    bindScope(viewFlash);
    $("#flipdir").onchange = e => { state.settings.flip = e.target.value; save(); viewFlash(); };
    const deck = pickSession(), results = [];
    let i = 0, flipped = false;

    const face = (c, side) => side === "term"
      ? `<div class="text-3xl md:text-4xl font-bold">${esc(c.term)}</div>${c.jp ? `<div class="text-xl opacity-60 mt-2 jp">${esc(c.jp)}</div>` : ""}`
      : `<p class="text-base md:text-lg">${esc(side === "def-redacted" ? redact(c.def, c) : c.def)}</p>${side === "def" && c.note ? `<p class="text-sm mt-4 opacity-75">🎙️ ${esc(c.note)}</p>` : ""}${side === "def" && c.ex ? `<p class="text-xs mt-2 opacity-60">e.g. ${esc(c.ex)}</p>` : ""}`;

    function render() {
      if (i >= deck.length) return summary(results, viewFlash);
      const c = deck[i];
      const [front, back] = flipFront === "term" ? ["term", "def"] : ["def-redacted", "term"];
      $("#stage").innerHTML = counter(i, deck.length) + `
        <div class="flip max-w-xl mx-auto" id="fc">
          <div class="flip-inner">
            <div class="flip-face card bg-base-100 shadow-lg border border-base-300"><div class="card-body items-center justify-center text-center overflow-y-auto">
              <span class="badge badge-ghost mb-2">${unitOf(c.unit).icon} ${esc(unitOf(c.unit).title)}</span>${face(c, front)}<p class="text-xs opacity-50 mt-6">click or press Space to flip</p></div></div>
            <div class="flip-face flip-back card bg-base-100 shadow-lg border border-primary"><div class="card-body items-center justify-center text-center overflow-y-auto">
              ${back === "term" ? face(c, "term") + `<div class="divider my-2"></div>` + (c.note ? `<p class="text-sm opacity-75">🎙️ ${esc(c.note)}</p>` : "") : face(c, back)}</div></div>
          </div>
        </div>
        <div id="grade" class="flex justify-center gap-3 mt-6 invisible">
          <button id="bad" class="btn btn-error btn-outline w-32">Again <kbd class="kbd kbd-xs">1</kbd></button>
          <button id="good" class="btn btn-success w-32">Got it <kbd class="kbd kbd-xs">2</kbd></button>
        </div>`;
      $("#fc").onclick = flip;
      $("#bad").onclick = () => grade(false);
      $("#good").onclick = () => grade(true);
    }
    function flip() {
      flipped = !flipped;
      $("#fc").classList.toggle("flipped", flipped);
      if (flipped) $("#grade").classList.remove("invisible");
    }
    function grade(ok) { record(deck[i].id, ok, "flash"); results.push({ id: deck[i].id, ok }); i++; flipped = false; render(); }
    onKey(e => {
      if (e.key === " ") { e.preventDefault(); flip(); }
      else if (flipped && e.key === "1") grade(false);
      else if (flipped && e.key === "2") grade(true);
    });
    render();
  }

  // --- Multiple choice ---
  function viewQuiz() {
    app().innerHTML = practiceShell("Multiple choice", "Pick the term that matches the description. Keys: 1–4 to answer, Enter for next.");
    bindScope(viewQuiz);
    const deck = pickSession(), results = [];
    let i = 0;

    function render() {
      if (i >= deck.length) return summary(results, viewQuiz);
      const c = deck[i];
      const sameUnit = ALL.filter(x => x.unit === c.unit && x.id !== c.id);
      const distractors = shuffle(sameUnit.length >= 3 ? sameUnit : ALL.filter(x => x.id !== c.id)).slice(0, 3);
      const options = shuffle([c, ...distractors]);
      let answered = false;
      $("#stage").innerHTML = counter(i, deck.length) + `
        <div class="card bg-base-100 shadow border border-base-300 max-w-xl mx-auto"><div class="card-body">
          <span class="badge badge-ghost">${unitOf(c.unit).icon} ${esc(unitOf(c.unit).title)}</span>
          <p class="text-lg my-3">${esc(redact(c.def, c))}</p>
          <div class="grid gap-2" id="opts">
            ${options.map((o, k) => `<button data-id="${o.id}" class="btn btn-outline justify-start h-auto py-3 normal-case text-left"><kbd class="kbd kbd-sm">${k + 1}</kbd> ${esc(o.term)} ${o.jp ? `<span class="opacity-50 jp font-normal">${esc(o.jp)}</span>` : ""}</button>`).join("")}
          </div>
          <div id="fb"></div>
        </div></div>`;
      const btns = [...document.querySelectorAll("#opts button")];
      const choose = btn => {
        if (answered) return; answered = true;
        const ok = btn.dataset.id === c.id;
        btns.forEach(b => { b.disabled = true; if (b.dataset.id === c.id) b.classList.add("btn-success", "!opacity-100"); });
        if (!ok) btn.classList.add("btn-error", "!opacity-100");
        record(c.id, ok, "quiz"); results.push({ id: c.id, ok });
        $("#fb").innerHTML = `
          <div class="alert ${ok ? "alert-success" : "alert-error"} mt-4"><span>${ok ? "Correct!" : `It's <b>${esc(c.term)}</b>.`}</span></div>
          ${c.note ? `<p class="text-sm opacity-75 mt-3">🎙️ ${esc(c.note)}</p>` : ""}
          <div class="card-actions justify-end mt-4"><button id="next" class="btn btn-primary">Next <kbd class="kbd kbd-xs">↵</kbd></button></div>`;
        $("#next").onclick = () => { i++; render(); };
      };
      btns.forEach(b => b.onclick = () => choose(b));
      onKey(e => {
        if (!answered && /^[1-4]$/.test(e.key) && btns[e.key - 1]) choose(btns[e.key - 1]);
        else if (answered && e.key === "Enter") { i++; render(); }
      });
    }
    render();
  }

  // --- Type the answer ---
  function viewType() {
    app().innerHTML = practiceShell("Type the answer", "Type the term described. Capitalization, macrons (ō), hyphens and spaces don't matter, and common alternate spellings are accepted.");
    bindScope(viewType);
    const deck = pickSession(), results = [];
    let i = 0;

    function render() {
      if (i >= deck.length) return summary(results, viewType);
      const c = deck[i];
      let hints = 0, done = false;
      $("#stage").innerHTML = counter(i, deck.length) + `
        <div class="card bg-base-100 shadow border border-base-300 max-w-xl mx-auto"><div class="card-body">
          <span class="badge badge-ghost">${unitOf(c.unit).icon} ${esc(unitOf(c.unit).title)}</span>
          <p class="text-lg my-3">${esc(redact(c.def, c))}</p>
          <div id="hint" class="text-sm opacity-70 min-h-5"></div>
          <form id="tf" class="join w-full mt-2" autocomplete="off">
            <input id="ans" class="input input-bordered join-item w-full" placeholder="Your answer…" autofocus />
            <button class="btn btn-primary join-item">Check</button>
          </form>
          <div class="flex gap-2 mt-2"><button id="hintbtn" class="btn btn-ghost btn-xs">Hint</button><button id="skip" class="btn btn-ghost btn-xs">I don't know</button></div>
          <div id="fb"></div>
        </div></div>`;
      const input = $("#ans"); input.focus();
      $("#hintbtn").onclick = () => {
        hints++;
        const h = [];
        if (c.jp) h.push(`Japanese: <span class="jp">${esc(c.jp)}</span>`);
        h.push(`Starts with “${esc(c.term.replace(/^-/, "").slice(0, hints))}”, ${c.term.length} characters`);
        $("#hint").innerHTML = h.join(" · ");
      };
      const finish = (ok, given, close) => {
        done = true;
        input.disabled = true;
        $("#tf button").disabled = true;
        record(c.id, ok, "type"); results.push({ id: c.id, ok });
        $("#fb").innerHTML = `
          <div class="alert ${ok ? "alert-success" : close ? "alert-warning" : "alert-error"} mt-4 flex-col items-start gap-1">
            <span>${ok ? "Correct!" : close ? "Close, but not exact." : given ? "Not quite." : "Here's the answer."} The answer is <b>${esc(c.term)}</b>${c.jp ? ` <span class="jp">(${esc(c.jp)})</span>` : ""}.</span>
            ${!ok && given ? `<span class="text-sm">You wrote: <code>${esc(given)}</code></span>` : ""}
            ${c.alt?.length ? `<span class="text-xs opacity-75">Also accepted: ${c.alt.map(esc).join(", ")}</span>` : ""}
          </div>
          ${c.note ? `<p class="text-sm opacity-75 mt-3">🎙️ ${esc(c.note)}</p>` : ""}
          <div class="card-actions justify-end mt-4">
            ${!ok && given ? `<button id="override" class="btn btn-ghost btn-sm">I was right, count it</button>` : ""}
            <button id="next" class="btn btn-primary">Next <kbd class="kbd kbd-xs">↵</kbd></button>
          </div>`;
        const next = () => { i++; render(); };
        $("#next").onclick = next;
        const ov = $("#override");
        if (ov) ov.onclick = () => { overrideLast(c.id); results[results.length - 1].ok = true; next(); };
        onKey(e => { if (e.key === "Enter") next(); });
      };
      $("#tf").onsubmit = e => {
        e.preventDefault();
        if (done) return;
        const given = input.value.trim();
        if (!given) return;
        const g = norm(given);
        const answers = [c.term, ...(c.alt || [])].map(norm);
        const ok = answers.includes(g);
        const close = !ok && answers.some(a => lev(a, g) <= Math.max(1, Math.floor(a.length / 6)));
        finish(ok, given, close);
      };
      $("#skip").onclick = () => !done && finish(false, "", false);
      onKey(null);
    }
    render();
  }

  // --- Progress ---
  function viewProgress() {
    const o = overall();
    const weak = ALL.filter(c => stat(c.id).wrong).sort((a, b) => stat(b.id).wrong - stat(a.id).wrong || stat(a.id).box - stat(b.id).box).slice(0, 10);
    const modeName = { flash: "Flashcard", quiz: "Multiple choice", type: "Type-it" };
    app().innerHTML = `
      <h1 class="text-2xl font-bold mb-6">Progress</h1>
      <div class="stats stats-vertical sm:stats-horizontal shadow w-full mb-8 bg-base-100">
        <div class="stat"><div class="stat-title">Mastered</div><div class="stat-value text-primary">${o.mastered}/${o.total}</div><div class="stat-desc">${o.pct}% overall mastery</div></div>
        <div class="stat"><div class="stat-title">Seen</div><div class="stat-value">${o.seen}/${o.total}</div></div>
        <div class="stat"><div class="stat-title">Accuracy</div><div class="stat-value">${o.acc ?? "—"}${o.acc != null ? "%" : ""}</div><div class="stat-desc">${o.answered} answers</div></div>
      </div>
      <div class="overflow-x-auto mb-8"><table class="table bg-base-100 rounded-box">
        <thead><tr><th>Unit</th><th>Read</th><th class="w-1/3">Mastery</th><th>Seen</th></tr></thead>
        <tbody>${UNITS.map(u => { const p = unitProgress(u); return `<tr>
          <td><a class="link link-hover" href="#/learn/${u.id}">${u.icon} ${esc(u.title)}</a></td>
          <td>${state.read[u.id] ? "✓" : "—"}</td>
          <td><div class="flex items-center gap-2"><progress class="progress progress-primary" value="${p.pct}" max="100"></progress><span class="text-xs whitespace-nowrap">${p.pct}% · ${p.mastered}/${p.total}</span></div></td>
          <td class="text-sm">${p.seen}/${p.total}</td></tr>`; }).join("")}</tbody>
      </table></div>
      <div class="grid md:grid-cols-2 gap-6 mb-8">
        <div class="card bg-base-100 border border-base-300"><div class="card-body">
          <h2 class="card-title text-lg">Trickiest cards</h2>
          ${weak.length ? `<ul class="text-sm space-y-1">${weak.map(c => `<li class="flex justify-between gap-2"><a class="link link-hover" href="#/learn/${c.unit}">${esc(c.term)}</a><span class="opacity-60">${stat(c.id).wrong}✗ ${stat(c.id).right}✓</span></li>`).join("")}</ul>` : `<p class="text-sm opacity-60">Nothing missed yet.</p>`}
        </div></div>
        <div class="card bg-base-100 border border-base-300"><div class="card-body">
          <h2 class="card-title text-lg">Recent answers</h2>
          ${state.history.length ? `<ul class="text-sm space-y-1">${state.history.slice(0, 12).map(h => `<li class="flex justify-between gap-2"><span>${h.ok ? "✅" : "❌"} ${esc(BY_ID[h.id]?.term ?? h.id)}</span><span class="opacity-50 text-xs">${modeName[h.mode]} · ${new Date(h.t).toLocaleDateString()}</span></li>`).join("")}</ul>` : `<p class="text-sm opacity-60">No answers yet.</p>`}
        </div></div>
      </div>
      <div class="card bg-base-200"><div class="card-body">
        <h2 class="card-title text-lg">Your data</h2>
        <p class="text-sm opacity-75">Progress saves automatically in this browser. Export a backup file to move it to another browser or computer.</p>
        <div class="flex flex-wrap gap-2 mt-2">
          <button id="export" class="btn btn-sm">Export progress</button>
          <label class="btn btn-sm">Import progress<input id="import" type="file" accept=".json,application/json" class="hidden" /></label>
          <button id="reset" class="btn btn-sm btn-error btn-outline">Reset all progress</button>
        </div>
      </div></div>`;
    $("#export").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
      a.download = `anime-primer-progress-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    };
    $("#import").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const s = JSON.parse(await f.text());
        if (!s.cards) throw new Error("not a progress file");
        state = { ...fresh(), ...s, settings: { ...fresh().settings, ...s.settings } };
        save(); toast("Progress imported"); viewProgress();
      } catch (err) { toast("Couldn't read that file: " + err.message, "error"); }
    };
    $("#reset").onclick = () => {
      if (!confirm("Erase all progress? This can't be undone (export first if unsure).")) return;
      const theme = state.settings.theme; state = fresh(); state.settings.theme = theme; save(); viewProgress();
    };
  }

  function toast(msg, kind = "success") {
    const t = document.createElement("div");
    t.className = "toast toast-end z-50";
    t.innerHTML = `<div class="alert alert-${kind}"><span>${esc(msg)}</span></div>`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  // ---------- theme ----------
  const LIGHT = "winter", DARK = "night";
  function applyTheme() {
    const t = state.settings.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? DARK : LIGHT);
    document.documentElement.dataset.theme = t;
    $("#themebtn").textContent = t === DARK ? "☀️" : "🌙";
  }
  $("#themebtn").onclick = () => {
    state.settings.theme = document.documentElement.dataset.theme === DARK ? LIGHT : DARK;
    save(); applyTheme();
  };

  // ---------- router ----------
  function route() {
    onKey(null);
    const [, view, arg] = (location.hash || "#/").split("/");
    document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === (view || "")));
    ({ learn: () => viewUnit(arg), flash: viewFlash, quiz: viewQuiz, type: viewType, progress: viewProgress }[view] || viewHome)();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  applyTheme();
  route();
})();
