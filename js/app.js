(() => {
  const $ = (s) => document.querySelector(s);
  const HAN = /\p{Script=Han}/u;
  const { pinyin } = window.pinyinPro;
  const MAX = 40;

  const input = $('#ink-input');
  const gallery = $('#gallery');
  const state = { items: [], seeds: {}, detail: -1, cls: 0, clsShowPy: false };

  // ---------- 拼音 ----------
  function analyse(text) {
    const chars = [...text].filter((c) => HAN.test(c)).slice(0, MAX);
    const joined = chars.join('');
    let info = [];
    try { info = pinyin(joined, { type: 'all' }); } catch (e) { console.warn(e); }
    return chars.map((ch, i) => {
      const d = info[i] || {};
      return {
        ch,
        py: d.pinyin || '',
        tone: Number.isFinite(d.num) ? d.num : 0,
        initial: d.initial || '',
        final: d.final || '',
        poly: (d.polyphonic || []).filter((x) => x && x !== d.pinyin),
      };
    });
  }
  const pyOf = (s) => { try { return pinyin(s, { type: 'array' }); } catch { return []; } };
  const toneName = ['轻声', '第一声 ˉ', '第二声 ˊ', '第三声 ˇ', '第四声 ˋ'];

  // ---------- 朗读 ----------
  let zhVoice = null;
  function pickVoice() {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    zhVoice = vs.find((v) => /zh[-_]CN/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
  }
  if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function say(text) {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = 0.75; u.pitch = 1.1;
    if (zhVoice) u.voice = zhVoice;
    speechSynthesis.speak(u);
  }

  // ---------- 画廊 ----------
  function pyHTML(it) { return `<span class="tone-${it.tone}">${it.py}</span>`; }

  function makeCard(it, idx) {
    const el = document.createElement('article');
    el.className = 'card';
    el.style.animationDelay = `${Math.min(idx, 12) * 70}ms`;
    el.innerHTML = `
      <canvas aria-label="${it.ch} 的水墨画"></canvas>
      ${it.poly.length ? '<span class="badge">多音字</span>' : ''}
      <div class="meta">
        <span class="hz">${it.ch}</span>
        <span class="py">${pyHTML(it)}</span>
        <span class="tools">
          <button data-act="say" title="读一读">🔊</button>
          <button data-act="open" title="学字卡">✍</button>
        </span>
      </div>`;
    el.dataset.ch = it.ch;
    el.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      const i = [...gallery.children].indexOf(el);
      if (act === 'say') { e.stopPropagation(); say(it.ch); return; }
      openDetail(i);
    });
    return el;
  }

  function update(text, { force = false } = {}) {
    const items = analyse(text);
    const old = state.items;
    state.items = items;
    const cards = [...gallery.children];
    items.forEach((it, i) => {
      const prev = old[i];
      if (!force && prev && prev.ch === it.ch && prev.py === it.py && cards[i]) return;
      const card = makeCard(it, i);
      if (cards[i]) gallery.replaceChild(card, cards[i]); else gallery.appendChild(card);
      requestAnimationFrame(() => Ink.render(card.querySelector('canvas'), it.ch, { seed: state.seeds[it.ch] || 0 }));
      if ($('#opt-speak').checked && i === items.length - 1 && (!prev || prev.ch !== it.ch)) say(it.ch);
    });
    while (gallery.children.length > items.length) gallery.lastChild.remove();
    $('#empty').hidden = items.length > 0;
    const url = new URL(location.href);
    if (items.length) url.searchParams.set('t', items.map((x) => x.ch).join('')); else url.searchParams.delete('t');
    history.replaceState(null, '', url);
  }

  // 输入法组字时不打断，组字结束后再作画
  let composing = false, timer = 0;
  input.addEventListener('compositionstart', () => (composing = true));
  input.addEventListener('compositionend', () => { composing = false; schedule(); });
  input.addEventListener('input', () => { if (!composing) schedule(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !composing) { clearTimeout(timer); update(input.value); } });
  function schedule() { clearTimeout(timer); timer = setTimeout(() => update(input.value), 450); }
  $('#btn-paint').addEventListener('click', () => update(input.value));
  $('#btn-clear').addEventListener('click', () => { input.value = ''; update(''); input.focus(); });
  $('#opt-pinyin').addEventListener('change', (e) => document.body.classList.toggle('hide-pinyin', !e.target.checked));

  const lessons = $('#lessons');
  window.LESSONS.forEach((l) => {
    const b = document.createElement('button');
    b.innerHTML = `<b>${l.name}</b>${l.text}`;
    b.addEventListener('click', () => { input.value = l.text; update(l.text); });
    lessons.appendChild(b);
  });

  // ---------- 学字卡 ----------
  const dlg = $('#detail');
  let writer = null;

  function ruby(text) {
    const pys = pyOf(text);
    return [...text].map((c, i) => (HAN.test(c) ? `<ruby>${c}<rt>${pys[i] || ''}</rt></ruby>` : `<span>${c}</span>`)).join('');
  }

  function openDetail(i) {
    const it = state.items[i];
    if (!it) return;
    state.detail = i;
    const entry = window.LEXICON[it.ch];
    $('#d-pinyin').innerHTML = pyHTML(it) + (it.poly.length ? `<span class="poly">多音字：还读 ${it.poly.join('、')}</span>` : '');
    $('#d-parts').innerHTML = [
      it.initial ? `<span>声母<b>${it.initial}</b></span>` : '<span>零声母</span>',
      `<span>韵母<b>${it.final}</b></span>`,
      `<span class="tone-${it.tone}">${toneName[it.tone] || ''}</span>`,
    ].join('');
    const words = entry ? entry[1] : [];
    $('#d-words').innerHTML = words.length
      ? words.map((w) => `<span class="word" data-say="${w}">${ruby(w)}</span>`).join('')
      : `<span class="word" data-say="${it.ch}">${ruby(it.ch)}</span><span style="color:#9c8e74;align-self:center">（请老师和小朋友一起来组词）</span>`;
    const line = entry ? entry[2] : '';
    $('#d-line').innerHTML = line ? ruby(line) : '';
    $('#d-line').dataset.say = line;
    $('#d-line').parentElement.hidden = !line;
    $('#d-strokes').textContent = '';

    if (!dlg.open) dlg.showModal();
    Ink.render($('#detail-canvas'), it.ch, { seed: state.seeds[it.ch] || 0 });
    setupWriter(it.ch);
    if ($('#opt-speak').checked) say(it.ch);
  }

  function setupWriter(ch) {
    const box = $('#d-writer');
    box.innerHTML = '';
    writer = null;
    if (!window.HanziWriter) { box.innerHTML = `<div class="fallback">${ch}</div>`; return; }
    const size = box.clientWidth || 200;
    try {
      writer = HanziWriter.create(box, ch, {
        width: size, height: size, padding: 12,
        strokeColor: '#1b1a1f', radicalColor: '#b8352a', outlineColor: '#e6dcc6',
        strokeAnimationSpeed: 0.9, delayBetweenStrokes: 250, showCharacter: true,
        onLoadCharDataSuccess: (d) => { $('#d-strokes').textContent = `共 ${d.strokes.length} 画（红色为部首）`; },
        onLoadCharDataError: () => { box.innerHTML = `<div class="fallback">${ch}</div>`; writer = null; $('#d-strokes').textContent = '笔顺数据需要联网加载'; },
      });
    } catch (e) { box.innerHTML = `<div class="fallback">${ch}</div>`; }
  }

  $('#d-speak').addEventListener('click', () => { const it = state.items[state.detail]; it && say(it.ch); });
  $('#d-stroke').addEventListener('click', () => writer && writer.animateCharacter());
  $('#d-quiz').addEventListener('click', () => {
    if (!writer) return;
    $('#d-strokes').textContent = '用手指或鼠标，按笔顺描一描';
    writer.quiz({
      onComplete: (s) => { $('#d-strokes').textContent = s.totalMistakes ? `写完啦！错了 ${s.totalMistakes} 次，再试试？` : '写得真棒！一笔都没错 🌟'; say('真棒'); },
    });
  });
  $('#btn-repaint').addEventListener('click', () => {
    const it = state.items[state.detail];
    if (!it) return;
    state.seeds[it.ch] = (state.seeds[it.ch] || 0) + 1;
    Ink.render($('#detail-canvas'), it.ch, { seed: state.seeds[it.ch] });
    const card = gallery.children[state.detail];
    card && Ink.render(card.querySelector('canvas'), it.ch, { seed: state.seeds[it.ch] });
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    const s = e.target.closest('[data-say]');
    if (s && s.dataset.say) say(s.dataset.say);
  });
  dlg.addEventListener('close', () => { if (writer) { try { writer.cancelQuiz(); } catch {} } });

  // ---------- 课堂模式 ----------
  const cls = $('#classroom');
  function showSlide(i) {
    const n = state.items.length;
    state.cls = (i + n) % n;
    const it = state.items[state.cls];
    const py = $('#cls-pinyin');
    py.innerHTML = pyHTML(it);
    py.classList.toggle('hidden-py', !state.clsShowPy);
    $('#cls-reveal').textContent = state.clsShowPy ? '隐藏拼音' : '揭晓拼音';
    $('#cls-char').textContent = it.ch;
    const e = window.LEXICON[it.ch];
    $('#cls-line').innerHTML = e ? ruby(e[2]) : '';
    $('#cls-index').textContent = `${state.cls + 1} / ${n}`;
    Ink.render($('#cls-canvas'), it.ch, { seed: state.seeds[it.ch] || 0 });
  }
  function enterClass() {
    if (!state.items.length) { input.focus(); input.placeholder = '先写几个字，再进入课堂模式'; return; }
    state.clsShowPy = $('#opt-pinyin').checked;
    cls.hidden = false;
    document.documentElement.requestFullscreen?.().catch(() => {});
    requestAnimationFrame(() => showSlide(0));
  }
  function exitClass() {
    cls.hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  const revealPy = () => { state.clsShowPy = !state.clsShowPy; $('#cls-pinyin').classList.toggle('hidden-py', !state.clsShowPy); $('#cls-reveal').textContent = state.clsShowPy ? '隐藏拼音' : '揭晓拼音'; };
  $('#btn-class').addEventListener('click', enterClass);
  $('#cls-exit').addEventListener('click', exitClass);
  $('#cls-prev').addEventListener('click', () => showSlide(state.cls - 1));
  $('#cls-next').addEventListener('click', () => showSlide(state.cls + 1));
  $('#cls-say').addEventListener('click', () => say(state.items[state.cls].ch));
  $('#cls-reveal').addEventListener('click', revealPy);
  $('#cls-line').addEventListener('click', () => { const e = window.LEXICON[state.items[state.cls].ch]; e && say(e[2]); });
  document.addEventListener('keydown', (e) => {
    if (cls.hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') showSlide(state.cls + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') showSlide(state.cls - 1);
    else if (e.key === ' ') { e.preventDefault(); say(state.items[state.cls].ch); }
    else if (e.key === 'p' || e.key === 'P') revealPy();
    else if (e.key === 'Escape') exitClass();
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && !cls.hidden) exitClass(); });

  // 窗口尺寸变化后重画，保证清晰
  let rz = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      [...gallery.children].forEach((card, i) => { const it = state.items[i]; it && Ink.render(card.querySelector('canvas'), it.ch, { seed: state.seeds[it.ch] || 0, instant: true }); });
      if (!cls.hidden) showSlide(state.cls);
    }, 300);
  });

  // ---------- 启动 ----------
  const start = new URL(location.href).searchParams.get('t') || '山水日月';
  input.value = start;
  const go = () => update(start);
  (document.fonts ? document.fonts.load('40px InkBrush', '山').catch(() => {}) : Promise.resolve()).then(go, go);
})();
