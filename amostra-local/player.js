// Accessible player for a MangaWhisperer run. Opened by double-click from
// final/ (file://), so: classic script, the timeline comes from timeline.js
// (window.TIMELINE), no fetch, no server.
(function () {
  'use strict';
  var T = window.TIMELINE;
  var $ = function (id) { return document.getElementById(id); };

  function label(seg) {
    if (seg.kind === 'narration') return 'Narrador';
    if (seg.kind === 'sfx') return 'Efeito: ' + seg.text;
    return seg.speaker;
  }

  function show(seg) {
    $('onde').textContent = 'Página ' + seg.page + ' · ' + label(seg);
    $('texto').textContent = seg.text;
  }

  $('titulo').textContent = T.title;
  document.title = T.title + ' — MangaWhisperer';

  // One <audio> per stem, voice as the master clock. No AudioContext:
  // on file:// a MediaElementSource is CORS-tainted and plays silence.
  var els = {};
  Object.keys(T.stems).forEach(function (name) {
    var el = new Audio(T.stems[name]);
    el.preload = 'metadata';
    els[name] = el;
  });
  var master = els.voice;
  var names = Object.keys(els);
  var playBtn = $('play');
  var pos = $('pos');
  pos.max = T.duration_ms / 1000;

  function setPlaying(playing) {
    playBtn.textContent = playing ? 'Pausar' : 'Reproduzir';
  }

  playBtn.addEventListener('click', function () {
    if (master.paused) {
      names.forEach(function (n) { els[n].currentTime = master.currentTime; els[n].play(); });
      setPlaying(true);
    } else {
      names.forEach(function (n) { els[n].pause(); });
      setPlaying(false);
      save();
    }
  });
  master.addEventListener('ended', function () { setPlaying(false); });

  function segmentAt(t) {
    var found = null; // +1 ms: a seek to a segment's start may read back a hair early
    for (var i = 0; i < T.segments.length && T.segments[i].start_ms <= t * 1000 + 1; i++) found = T.segments[i];
    return found;
  }

  function clock(seconds) {
    var s = Math.floor(seconds), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    var two = function (n) { return String(n).padStart(2, '0'); };
    return (h ? h + ':' + two(m) : m) + ':' + two(s % 60);
  }

  var total = clock(T.duration_ms / 1000);
  // Links to the same pages in another version (the showcase's scriptwriter
  // switch, data-versao) carry the current page, so a switch keeps it.
  // The current version's own link carries none: followed, it would only put #pagina=N in the URL.
  var versions = document.querySelectorAll('a[data-versao]:not([aria-current])');
  function where(t) {
    var seg = segmentAt(t);
    pos.value = t;
    pos.setAttribute('aria-valuetext', clock(t) + ' de ' + total + (seg ? ', página ' + seg.page : ''));
    if (seg) show(seg);
    if (seg) versions.forEach(function (a) { a.hash = 'pagina=' + seg.page; });
  }

  function seek(t) {
    names.forEach(function (n) { els[n].currentTime = t; });
    where(t);
  }
  pos.addEventListener('input', function () { seek(Number(pos.value)); });

  function announce(message) { $('aviso').textContent = message; }

  // At either end a press must still say something: silence reads as "broken".
  // ponytail: wording to settle in the NVDA session (SESSAO-TESTE-PLAYER.md)
  function go(seg, edge) {
    if (!seg) return announce(edge);
    var stays = Math.abs(master.currentTime - seg.start_ms / 1000) < 0.01; // already there: nothing before it
    seek(seg.start_ms / 1000);
    announce(stays ? edge : $('onde').textContent);
  }

  // "Anterior" first rewinds to the start of the current line/page when
  // more than 2 s in — how you repeat what you just heard.
  function back(list) {
    var t = master.currentTime, current = null, i;
    for (i = 0; i < list.length && list[i].start_ms <= t * 1000 + 1; i++) current = list[i];
    if (current && t - current.start_ms / 1000 > 2) return current;
    return list[Math.max(0, i - 2)];
  }

  function ahead(list) {
    var t = master.currentTime;
    for (var i = 0; i < list.length; i++) if (list[i].start_ms > t * 1000 + 1) return list[i];
    return null;
  }

  var pageStarts = T.segments.filter(function (s, i) { return i === 0 || s.page !== T.segments[i - 1].page; });
  $('proxima-fala').addEventListener('click', function () { go(ahead(T.segments), 'Fim do volume.'); });
  $('fala-anterior').addEventListener('click', function () { go(back(T.segments), 'Início do volume.'); });
  $('proxima-pagina').addEventListener('click', function () { go(ahead(pageStarts), 'Fim do volume.'); });
  $('pagina-anterior').addEventListener('click', function () { go(back(pageStarts), 'Início do volume.'); });
  $('onde-estou').addEventListener('click', function () {
    var t = master.currentTime, seg = segmentAt(t);
    announce((seg ? 'Página ' + seg.page + ', quadro ' + (seg.panel + 1) + ', ' + label(seg) + ', ' : '') +
             clock(t) + ' de ' + total);
  });

  // The slider (and what a screen reader hears on it) changes once per
  // second at most; the stems are pulled back when they drift.
  // ponytail: 3 elements resynced at 0.25 s — one 3-channel stems file + ChannelSplitter if drift is audible (needs http, not file://)
  var lastSecond = -1;
  master.addEventListener('timeupdate', function () {
    var t = master.currentTime;
    if (Math.floor(t) !== lastSecond) {
      lastSecond = Math.floor(t);
      where(t);
      if (lastSecond % 5 === 0 && !master.paused) save();
    }
    names.forEach(function (n) { if (Math.abs(els[n].currentTime - t) > 0.25) els[n].currentTime = t; });
  });
  where(0);

  // One slider per channel that exists in this run; the effects of every
  // density (sfx_1..sfx_3, or a single "sfx" in older runs) share one.
  // ponytail: element.volume (ignored on iOS) — GainNode when the public P&C showcase is served over https (F1b)
  var STEM_NAMES = { voice: 'voz', music: 'música', sfx: 'efeitos', ambience: 'ambiente' };
  function channel(name) { return /^sfx(_\d)?$/.test(name) ? 'sfx' : name; }
  var volumeInputs = {};
  function setVolume(ch, percent) {
    var input = volumeInputs[ch];
    input.value = percent;
    input.setAttribute('aria-valuetext', input.value + '%');
    names.forEach(function (n) { if (channel(n) === ch) els[n].volume = Number(input.value) / 100; });
  }
  names.map(channel).filter(function (ch, i, all) { return all.indexOf(ch) === i; }).forEach(function (ch) {
    var label = document.createElement('label');
    var input = document.createElement('input');
    input.type = 'range';
    input.id = 'volume-' + ch;
    input.min = 0;
    input.max = 100;
    input.step = 5;
    label.htmlFor = input.id;
    label.textContent = 'Volume: ' + (STEM_NAMES[ch] || ch);
    $('volumes').append(label, input);
    volumeInputs[ch] = input;
    setVolume(ch, 100);
    input.addEventListener('input', function () { setVolume(ch, input.value); save(); });
  });

  // How many effects: one cumulative stem per density plays in sync with the
  // voice and only the chosen one is heard, so a switch never moves the position.
  var LEVELS = ['Nenhum', 'Poucos', 'Médio', 'Muitos'];
  var hasLevels = names.indexOf('sfx_1') >= 0;
  var level = 2; // Médio
  var radios = [];
  function setLevel(value) {
    level = value;
    radios.forEach(function (radio, i) { radio.checked = i === level; });
    names.forEach(function (n) { if (/^sfx_\d$/.test(n)) els[n].muted = n !== 'sfx_' + level; });
  }
  // What each choice plays, counted from this run's cues (a cue plays from its level up), read
  // with the choice: never a fixed number, which no run keeps (SPEC-SONOPLASTIA §8.3).
  function perMinute(value) {
    if (!value) return 'desliga os efeitos';
    var rate = (T.cues || []).filter(function (c) { return c.level <= value; }).length / (T.duration_ms / 60000);
    if (!rate) return 'nenhum efeito nesta execução';
    var said = rate.toFixed(1); // what is read aloud decides the plural: 1,96 is '2,0 efeitos'
    if (said === '0.0') return 'menos de 0,1 efeito por minuto'; // some play: never 'cerca de 0,0'
    return 'cerca de ' + said.replace('.', ',') + (said < 2 ? ' efeito' : ' efeitos') + ' por minuto';
  }
  if (hasLevels) {
    LEVELS.forEach(function (text, i) {
      var row = document.createElement('div');
      var label = document.createElement('label');
      var radio = document.createElement('input');
      var rate = document.createElement('span');
      radio.type = 'radio';
      radio.name = 'efeitos';
      radio.value = i;
      rate.id = 'efeitos-' + i;
      rate.textContent = perMinute(i);
      radio.setAttribute('aria-describedby', rate.id);
      label.append(radio, text);
      row.append(label, rate);
      $('efeitos').append(row);
      radios.push(radio);
      radio.addEventListener('change', function () { setLevel(i); save(); });
    });
    $('efeitos').hidden = false;
    setLevel(level);
  }

  // Resume where the listener stopped. Chrome shares one storage among all
  // file:// pages, hence the per-volume key for the position; the volumes and
  // the effects density are the listener's, one set for every run (a showcase
  // version switch must not undo them; a run without some channel keeps what
  // is stored for it). Storage may be blocked (private window, policy), so
  // every access is guarded and the page works without it.
  var KEY = 'mangawhisperer:' + T.title;
  var VOLUMES = 'mangawhisperer:volumes';
  function save() {
    try {
      var settings = JSON.parse(localStorage.getItem(VOLUMES)) || {};
      Object.keys(volumeInputs).forEach(function (ch) { settings[ch] = Number(volumeInputs[ch].value); });
      if (hasLevels) settings.efeitos = level;
      localStorage.setItem(KEY, JSON.stringify({ t: master.currentTime }));
      localStorage.setItem(VOLUMES, JSON.stringify(settings));
    } catch (e) { /* no storage */ }
  }
  var saved = null, volumes = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY));
    volumes = JSON.parse(localStorage.getItem(VOLUMES));
  } catch (e) { /* no storage */ }
  // #pagina=N (a version switch) wins over the saved point: start of page N or the first page after it.
  var asked = /^#pagina=(\d+)$/.exec(location.hash);
  // Read once: left in the URL, a reload or the tab reopened went back to the page of the switch.
  if (asked) history.replaceState(null, '', location.pathname + location.search);
  var landing = asked && T.segments.filter(function (s) { return s.page >= Number(asked[1]); })[0];
  if (landing) {
    master.addEventListener('loadedmetadata', function () {
      seek(landing.start_ms / 1000);
      announce($('onde').textContent);
    }, { once: true });
  }
  volumes = volumes || (saved && saved.volumes) || {}; // older saves kept them per title
  Object.keys(volumes).forEach(function (n) { if (volumeInputs[n]) setVolume(n, volumes[n]); });
  if (hasLevels && [0, 1, 2, 3].indexOf(volumes.efeitos) >= 0) setLevel(volumes.efeitos);
  if (saved) {
    if (saved.t > 0 && !landing) {
      master.addEventListener('loadedmetadata', function () {
        seek(saved.t);
        announce('Retomando em ' + clock(saved.t));
      }, { once: true });
    }
  }
  window.addEventListener('pagehide', save);

  window.__player = { els: els }; // test hook (tests/web)
})();
