/*
 * 闯关学字：每个字固定四步 —— 看画猜字 → 听音辨调 → 看笔顺 → 描写过关。
 * 学习时画退成背景，过关后画重新清晰，作为奖励。进度存在 localStorage。
 */
(() => {
  // ---------- 进度 ----------
  const KEY = 'moyun.progress.v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const store = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
  window.Progress = {
    all: load,
    get: (ch) => load()[ch] || null,
    save(ch, stars, mistakes) {
      const d = load();
      const r = d[ch] || { best: 0, times: 0, totalMistakes: 0 };
      r.best = Math.max(r.best, stars);
      r.times += 1;
      r.mistakes = mistakes;
      r.totalMistakes += mistakes;
      r.last = Date.now();
      d[ch] = r;
      store(d);
    },
    clear: () => { try { localStorage.removeItem(KEY); } catch {} },
  };

  // ---------- 拼音声调 ----------
  const MARKS = { a: 'āáǎà', o: 'ōóǒò', e: 'ēéěè', i: 'īíǐì', u: 'ūúǔù', 'ü': 'ǖǘǚǜ' };
  const plain = (py) => py.normalize('NFD').replace(/[\u0300\u0301\u0304\u030c]/g, '').normalize('NFC');
  function mark(base, n) {
    let k = base.search(/[ae]/);
    if (k < 0) k = base.indexOf('ou');
    if (k < 0) for (let i = base.length - 1; i >= 0; i--) if ('iouü'.includes(base[i])) { k = i; break; }
    if (k < 0) return base;
    return base.slice(0, k) + MARKS[base[k]][n - 1] + base.slice(k + 1);
  }
  const TONE_CN = ['轻声', '一声', '二声', '三声', '四声'];

  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const $ = (s) => document.querySelector(s);

  // ---------- 关卡 ----------
  const el = $('#quest'), panel = $('#q-panel');
  const Q = { list: [], i: 0, step: 0, max: 0, miss: null, writer: null, results: [], saved: false, noData: false };
  const cur = () => Q.list[Q.i];
  const atFront = () => Q.step === Q.max; // 只在第一次闯这一步时记错，回看不扣分

  function start(items) {
    if (!items.length) return;
    Q.list = items.slice(); Q.results = [];
    el.hidden = false; el.classList.remove('summary');
    document.body.classList.add('noscroll');
    level(0);
  }

  function level(i) {
    Q.i = i; Q.max = 0; Q.saved = false; Q.noData = false;
    Q.miss = { guess: 0, tone: 0, write: 0 };
    el.classList.remove('summary');
    const it = cur();
    $('#q-level').textContent = `第 ${i + 1} / ${Q.list.length} 关`;
    requestAnimationFrame(() => Ink.render($('#q-canvas'), it.ch, { seed: App.state.seeds[it.ch] || 0 }));
    go(0);
  }

  function go(step) {
    killWriter();
    Q.step = step; Q.max = Math.max(Q.max, step);
    el.classList.toggle('dim', step >= 1 && step <= 3);
    el.classList.toggle('reward', step === 4);
    document.querySelectorAll('#q-steps li').forEach((li) => {
      const s = +li.dataset.step;
      li.classList.toggle('active', s === step);
      li.classList.toggle('done', s < Q.max || Q.max === 4);
      li.classList.toggle('open', s <= Q.max && s !== step);
    });
    [guess, tone, strokes, write, reward][step]();
  }

  function killWriter() {
    if (Q.writer) { try { Q.writer.cancelQuiz(); } catch {} Q.writer = null; }
  }

  // 一、看画猜字
  function guess() {
    const it = cur();
    const pool = shuffle([...new Set([...Q.list.map((x) => x.ch), ...shuffle(Object.keys(window.LEXICON)).slice(0, 12)])].filter((c) => c !== it.ch));
    const opts = shuffle([it.ch, ...pool.slice(0, 2)]);
    panel.innerHTML = `
      <h2 class="q-title">看画猜字</h2>
      <p class="q-hint">这幅画画的是哪个字？</p>
      <div class="q-options">${opts.map((c) => `<button class="q-opt hz-opt" data-c="${c}">${c}</button>`).join('')}</div>
      <button class="btn-ghost small" id="q-tip">🔊 听提示</button>`;
    const entry = window.LEXICON[it.ch];
    $('#q-tip').onclick = () => App.say(entry ? entry[2] : it.ch);
    panel.querySelectorAll('.q-opt').forEach((b) => (b.onclick = () => {
      if (b.dataset.c === it.ch) {
        b.classList.add('right');
        panel.querySelectorAll('.q-opt').forEach((x) => (x.disabled = true));
        App.say(it.ch);
        setTimeout(() => Q.step === 0 && go(1), 1100);
      } else {
        if (atFront()) Q.miss.guess++;
        b.classList.add('wrong'); b.disabled = true;
        App.say('再想想');
      }
    }));
  }

  // 二、听音辨调
  function tone() {
    const it = cur();
    const base = plain(it.py || '');
    const variants = [1, 2, 3, 4].map((n) => mark(base, n));
    const canQuiz = it.tone >= 1 && new Set(variants).size === 4;
    panel.innerHTML = `
      <h2 class="q-title">听音辨调</h2>
      <div class="q-char">${it.ch}</div>
      <button class="btn-primary" id="q-listen">🔊 听读音</button>
      <div id="q-tone-area"></div>`;
    $('#q-listen').onclick = () => App.say(it.ch);
    App.say(it.ch);
    const area = $('#q-tone-area');
    const reveal = () => {
      area.innerHTML = `
        <div class="q-py tone-${it.tone}">${it.py}</div>
        <div class="py-parts">
          ${it.initial ? `<span>声母<b>${it.initial}</b></span>` : '<span>零声母</span>'}
          <span>韵母<b>${it.final}</b></span>
          <span class="tone-${it.tone}">${TONE_CN[it.tone] || ''}</span>
        </div>
        ${it.poly.length ? `<p class="q-hint">它是多音字，还读 ${it.poly.join('、')}</p>` : ''}
        <button class="btn-primary" id="q-next">下一步 →</button>`;
      $('#q-next').onclick = () => go(2);
    };
    if (!canQuiz) { reveal(); return; }
    area.innerHTML = `
      <p class="q-hint">它读第几声？</p>
      <div class="q-options">${shuffle([1, 2, 3, 4]).map((n) => `<button class="q-opt py-opt tone-${n}" data-n="${n}">${variants[n - 1]}<small>${TONE_CN[n]}</small></button>`).join('')}</div>`;
    area.querySelectorAll('.q-opt').forEach((b) => (b.onclick = () => {
      if (+b.dataset.n === it.tone) {
        b.classList.add('right');
        App.say(it.ch);
        setTimeout(() => Q.step === 1 && reveal(), 700);
      } else {
        if (atFront()) Q.miss.tone++;
        b.classList.add('wrong'); b.disabled = true;
        App.say(b.textContent.replace(/[一二三四]声/, ''));
      }
    }));
  }

  function makeWriter(box, opts) {
    if (!window.HanziWriter) return null;
    const size = box.clientWidth || 260;
    return HanziWriter.create(box, cur().ch, {
      width: size, height: size, padding: 14,
      strokeColor: '#1b1a1f', radicalColor: '#b8352a', outlineColor: '#e3d7bd',
      highlightColor: '#d9822b', drawingColor: '#1b1a1f', drawingWidth: 18,
      strokeAnimationSpeed: 0.8, delayBetweenStrokes: 350, ...opts,
    });
  }

  // 三、看笔顺
  function strokes() {
    panel.innerHTML = `
      <h2 class="q-title">看笔顺</h2>
      <div class="tianzige q-box" id="q-writer"></div>
      <p class="q-hint" id="q-sc">笔顺加载中…</p>
      <div class="q-row">
        <button class="btn-ghost" id="q-replay">↻ 再看一遍</button>
        <button class="btn-primary" id="q-next" disabled>下一步 →</button>
      </div>`;
    const next = $('#q-next');
    next.onclick = () => go(3);
    const done = () => { next.disabled = false; };
    const box = $('#q-writer');
    const fail = () => {
      Q.noData = true; Q.writer = null;
      box.innerHTML = `<div class="fallback">${cur().ch}</div>`;
      $('#q-sc').textContent = '笔顺数据需要联网，这一步先跳过';
      done();
    };
    const w = makeWriter(box, {
      showCharacter: false,
      onLoadCharDataSuccess: (d) => { $('#q-sc').textContent = `共 ${d.strokes.length} 画，红色是部首`; },
      onLoadCharDataError: fail,
    });
    if (!w) return fail();
    Q.writer = w;
    const play = () => w.animateCharacter({ onComplete: done });
    play();
    $('#q-replay').onclick = () => { if (Q.writer) { w.hideCharacter(); play(); } };
  }

  // 四、描写过关
  function write() {
    if (Q.noData || !window.HanziWriter) {
      panel.innerHTML = `
        <h2 class="q-title">描写过关</h2>
        <div class="tianzige q-box"><div class="fallback">${cur().ch}</div></div>
        <p class="q-hint">联网后才能在这里描写。可以先在纸上写一写，再点过关。</p>
        <button class="btn-primary" id="q-pass">写好了，过关</button>`;
      $('#q-pass').onclick = () => go(4);
      return;
    }
    panel.innerHTML = `
      <h2 class="q-title">描写过关</h2>
      <div class="tianzige q-box" id="q-writer"></div>
      <p class="q-hint" id="q-status">按笔顺一笔一笔写，写错了会提示</p>
      <div class="q-row">
        <button class="btn-ghost" id="q-again">↻ 重写</button>
        <button class="btn-ghost" id="q-watch">先看笔顺</button>
      </div>`;
    $('#q-again').onclick = () => write();
    $('#q-watch').onclick = () => go(2);
    const status = $('#q-status');
    const w = makeWriter($('#q-writer'), { showCharacter: false, showOutline: true, onLoadCharDataError: () => { Q.noData = true; write(); } });
    Q.writer = w;
    w.quiz({
      showHintAfterMisses: 2,
      onMistake: () => { if (atFront()) Q.miss.write++; status.textContent = '这一笔不对，再试试（错两次会闪出提示）'; },
      onCorrectStroke: (d) => { status.textContent = `第 ${d.strokeNum + 1} 画 ✓ 还剩 ${d.strokesRemaining} 画`; },
      onComplete: () => { status.textContent = '写完啦！'; setTimeout(() => Q.step === 3 && go(4), 800); },
    });
  }

  // 过关：画重新清晰
  function reward() {
    const it = cur();
    const m = Q.miss, total = m.guess + m.tone + m.write;
    const stars = total === 0 ? 3 : total <= 3 ? 2 : 1;
    if (!Q.saved) {
      Q.saved = true;
      Progress.save(it.ch, stars, total);
      Q.results.push({ ch: it.ch, stars, total });
      App.refreshBadges();
      App.say(stars === 3 ? `真棒！${it.ch}` : `过关啦！${it.ch}`);
    }
    const entry = window.LEXICON[it.ch];
    const last = Q.i === Q.list.length - 1;
    const detail = total
      ? `猜字错 ${m.guess} 次 · 声调错 ${m.tone} 次 · 描写错 ${m.write} 笔`
      : '一次都没错！';
    panel.innerHTML = `
      <div class="q-stamp">过关</div>
      <div class="q-stars">${'★'.repeat(stars)}<span>${'★'.repeat(3 - stars)}</span></div>
      <div class="q-final"><span class="hz">${it.ch}</span>${App.pyHTML(it)}</div>
      <p class="q-hint">${detail}</p>
      ${entry ? `<div class="q-words">${entry[1].map((w) => `<span class="word" data-say="${w}">${App.ruby(w)}</span>`).join('')}</div>
      <div class="line" data-say="${entry[2]}">${App.ruby(entry[2])}</div>` : ''}
      <div class="q-row">
        <button class="btn-ghost" id="q-retry">↻ 再练一遍</button>
        <button class="btn-primary" id="q-next">${last ? '看看成绩' : '下一关 →'}</button>
      </div>`;
    panel.querySelectorAll('[data-say]').forEach((x) => (x.onclick = () => App.say(x.dataset.say)));
    $('#q-retry').onclick = () => level(Q.i);
    $('#q-next').onclick = () => (last ? summary() : level(Q.i + 1));
  }

  function summary() {
    killWriter();
    el.classList.add('summary'); el.classList.remove('dim', 'reward');
    $('#q-level').textContent = '闯关完成';
    document.querySelectorAll('#q-steps li').forEach((li) => li.classList.remove('active', 'open'));
    const got = Q.results.reduce((s, r) => s + r.stars, 0);
    panel.innerHTML = `
      <h2 class="q-title">今天学会了 ${Q.results.length} 个字</h2>
      <p class="q-hint">一共得到 ${got} 颗星</p>
      <div class="q-sum">${Q.results.map((r) => `<div><span class="hz">${r.ch}</span><span class="q-stars small">${'★'.repeat(r.stars)}<span>${'★'.repeat(3 - r.stars)}</span></span></div>`).join('')}</div>
      <div class="q-row">
        <button class="btn-ghost" id="q-again-all">↻ 再闯一次</button>
        <button class="btn-primary" id="q-home">回到画廊</button>
      </div>`;
    $('#q-again-all').onclick = () => start(Q.list);
    $('#q-home').onclick = exit;
  }

  function exit() {
    killWriter();
    el.hidden = true;
    document.body.classList.remove('noscroll');
  }

  $('#q-exit').onclick = exit;
  $('#q-steps').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li && li.classList.contains('open')) go(+li.dataset.step);
  });
  document.addEventListener('keydown', (e) => { if (!el.hidden && e.key === 'Escape') exit(); });

  $('#btn-quest').addEventListener('click', () => {
    const items = App.state.items;
    if (!items.length) { App.focusInput(); return; }
    start(items);
  });

  // ---------- 学习记录 ----------
  const rec = $('#records');
  function openRecords() {
    const d = load();
    const chars = Object.keys(d).sort((a, b) => d[b].last - d[a].last);
    const times = chars.reduce((s, c) => s + d[c].times, 0);
    $('#rec-sum').textContent = chars.length ? `已过关 ${chars.length} 个字，一共闯关 ${times} 次。` : '还没有记录，先去闯关吧！';
    $('#rec-grid').innerHTML = chars.map((c) => {
      const r = d[c];
      return `<div class="rec-item${r.mistakes ? ' weak' : ''}">
        <span class="hz">${c}</span>
        <span class="q-stars small">${'★'.repeat(r.best)}<span>${'★'.repeat(3 - r.best)}</span></span>
        <small>过关 ${r.times} 次 · 上次错 ${r.mistakes} 处</small></div>`;
    }).join('');
    $('#rec-review').disabled = !chars.some((c) => d[c].mistakes > 0);
    if (!rec.open) rec.showModal();
  }
  $('#btn-records').addEventListener('click', openRecords);
  rec.addEventListener('click', (e) => { if (e.target === rec || e.target.closest('[data-close]')) rec.close(); });
  $('#rec-clear').addEventListener('click', () => {
    if (!confirm('确定清除全部学习记录吗？')) return;
    Progress.clear(); App.refreshBadges(); openRecords();
  });
  $('#rec-review').addEventListener('click', () => {
    const d = load();
    const weak = Object.keys(d).filter((c) => d[c].mistakes > 0).sort((a, b) => d[b].mistakes - d[a].mistakes).slice(0, 10);
    if (!weak.length) return;
    rec.close();
    App.load(weak.join(''));
    start(App.state.items);
  });
})();
