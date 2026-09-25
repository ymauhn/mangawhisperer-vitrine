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
  function where(t) {
    var seg = segmentAt(t);
    pos.value = t;
    pos.setAttribute('aria-valuetext', clock(t) + ' de ' + total + (seg ? ', página ' + seg.page : ''));
    if (seg) show(seg);
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

  // One slider per stem that exists in this run.
  // ponytail: element.volume (ignored on iOS) — GainNode when the public P&C showcase is served over https (F1b)
  var STEM_NAMES = { voice: 'voz', music: 'música', sfx: 'efeitos' };
  var volumeInputs = {};
  function setVolume(name, percent) {
    var input = volumeInputs[name];
    input.value = percent;
    input.setAttribute('aria-valuetext', input.value + '%');
    els[name].volume = Number(input.value) / 100;
  }
  names.forEach(function (name) {
    var label = document.createElement('label');
    var input = document.createElement('input');
    input.type = 'range';
    input.id = 'volume-' + name;
    input.min = 0;
    input.max = 100;
    input.step = 5;
    label.htmlFor = input.id;
    label.textContent = 'Volume: ' + (STEM_NAMES[name] || name);
    $('volumes').append(label, input);
    volumeInputs[name] = input;
    setVolume(name, 100);
    input.addEventListener('input', function () { setVolume(name, input.value); });
  });

  // Resume where the listener stopped. Chrome shares one storage among all
  // file:// pages, hence the per-volume key; storage may be blocked (private
  // window, policy), so every access is guarded and the page works without it.
  var KEY = 'mangawhisperer:' + T.title;
  function save() {
    var volumes = {};
    names.forEach(function (n) { volumes[n] = Number(volumeInputs[n].value); });
    try { localStorage.setItem(KEY, JSON.stringify({ t: master.currentTime, volumes: volumes })); } catch (e) { /* no storage */ }
  }
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* no storage */ }
  if (saved) {
    Object.keys(saved.volumes || {}).forEach(function (n) { if (volumeInputs[n]) setVolume(n, saved.volumes[n]); });
    if (saved.t > 0) {
      master.addEventListener('loadedmetadata', function () {
        seek(saved.t);
        announce('Retomando em ' + clock(saved.t));
      }, { once: true });
    }
  }
  window.addEventListener('pagehide', save);

  window.__player = { els: els }; // test hook (tests/web)
})();
