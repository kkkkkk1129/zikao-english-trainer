/* ai-explain.js v3 — 星芒视觉 + AI引导员 + 错因讲解 + 学情诊断 + 点词释义 + 音效 + 原文浮层 */
(function () {
  if (typeof EXAM === 'undefined' || !EXAM.questions) return;
  var API_EXPLAIN = '/api/review/ai-explain';
  var API_SUMMARY = '/api/review/ai-summary';
  var API_WORD = '/api/review/word-lookup';
  var results = [], wrongStreak = 0, rightStreak = 0, summaryInjected = false;

  /* ---------- 星芒图标 ---------- */
  var SPARK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true" style="flex-shrink:0"><path d="M12 2c.9 5.2 3.9 8.2 9.1 9.1.4.07.4.7 0 .77-5.2.93-8.2 3.93-9.1 9.13-.9-5.2-3.9-8.2-9.1-9.13-.4-.07-.4-.7 0-.77C8.1 10.2 11.1 7.2 12 2z"/><path opacity=".65" d="M19 2.2l.75 1.85L21.6 4.8l-1.85.75L19 7.4l-.75-1.85-1.85-.75 1.85-.75L19 2.2z"/></svg>';

  /* ---------- 注入样式（呼吸光/漂浮/旋转） ---------- */
  var css = document.createElement('style');
  css.textContent = [
    '@keyframes aiBreath{0%,100%{box-shadow:0 4px 16px rgba(107,70,193,.32)}50%{box-shadow:0 6px 30px rgba(107,70,193,.62)}}',
    '@keyframes aiFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}',
    '@keyframes aiPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.35);opacity:.85}}',
    '@keyframes aiGlow{0%,100%{box-shadow:0 2px 10px rgba(43,108,176,.15);border-color:#D6BCFA}50%{box-shadow:0 6px 26px rgba(107,70,193,.45);border-color:#9F7AEA}}',
    '@keyframes aiSpin{to{transform:rotate(360deg)}}',
    '.ai-btn-primary{display:inline-flex;align-items:center;gap:9px;padding:13px 28px;border:none;border-radius:28px;background:linear-gradient(135deg,#1a365d,#553C9A 62%,#6B46C1);color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:1px;animation:aiBreath 3s ease-in-out infinite;transition:transform .2s}',
    '.ai-btn-primary:active{transform:scale(.97)}',
    '.ai-btn-primary:disabled{cursor:default;opacity:.85}',
    '.ai-btn-ghost{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border:1.5px solid transparent;border-radius:24px;background:linear-gradient(#fff,#fff) padding-box,linear-gradient(135deg,#2B6CB0,#6B46C1) border-box;color:#553C9A;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:transform .2s}',
    '.ai-btn-ghost:active{transform:scale(.97)}',
    '.ai-btn-ghost:disabled{cursor:default;opacity:.7}',
    '.ai-guide{display:flex;align-items:center;gap:10px;margin:14px 20px;padding:13px 16px;border-radius:14px;background:linear-gradient(135deg,#F0F5FF,#FAF5FF);border:1px solid #D6BCFA;color:#44337A;font-size:13px;font-weight:500;cursor:pointer;line-height:1.6;transition:opacity .3s,transform .2s;animation:aiGlow 2.4s ease-in-out infinite}',
    '.ai-guide:active{transform:scale(.99)}',
    '.ai-guide .gic{display:inline-flex;color:#6B46C1;animation:aiPulse 2s ease-in-out infinite;transform-origin:center}',
    '.ai-spin svg{animation:aiSpin 1.5s linear infinite}'
  ].join('\n');
  document.head.appendChild(css);

  /* ---------- 工具 ---------- */
  function norm(t) {
    t = (t || '').toUpperCase();
    if (t.indexOf('NOT') > -1) return 'NOT GIVEN';
    if (t.indexOf('TRUE') > -1) return 'TRUE';
    if (t.indexOf('FALSE') > -1) return 'FALSE';
    return t.replace(/\s+/g, ' ').trim();
  }
  function stripTags(s) { return String(s).replace(/<[^>]+>/g, ''); }
  function evidenceOf(q) {
    return (q.hl || []).map(function (id) {
      var el = document.getElementById(id);
      return el ? el.textContent.trim() : '';
    }).filter(Boolean).join(' ');
  }
  function typewriter(el, text, speed) {
    var chars = Array.from(String(text).replace(/\*\*/g, ''));
    var i = 0;
    var t = setInterval(function () {
      el.textContent = chars.slice(0, ++i).join('');
      if (i >= chars.length) clearInterval(t);
    }, speed || 16);
  }
  function setBtn(b, icon, text) {
    b.innerHTML = icon + '<span>' + text + '</span>';
  }
  function aiCard() {
    var c = document.createElement('div');
    c.style.cssText = 'position:relative;margin-top:10px;padding:14px 14px 12px;background:#F7FAFF;border:1px solid #BEE3F8;border-left:3px solid #6B46C1;border-radius:8px;font-size:13px;line-height:1.9;color:#2D3748;white-space:pre-wrap';
    var tag = document.createElement('span');
    tag.innerHTML = SPARK.replace('width="15" height="15"', 'width="10" height="10"') + ' AI生成 · 教师审核';
    tag.style.cssText = 'position:absolute;top:8px;right:10px;display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#A0AEC0;border:1px solid #E2E8F0;border-radius:10px;padding:1px 8px;background:#fff';
    c.appendChild(tag);
    var body = document.createElement('div');
    body.className = 'ai-dict-zone';
    body.style.marginTop = '14px';
    c.appendChild(body);
    c._body = body;
    return c;
  }

  /* ---------- AI 引导员：初始只见题目+原文，点击展开分步思路 ---------- */
  function setupGuides() {
    var cards = document.querySelectorAll('.qcard');
    for (var k = 0; k < cards.length; k++) {
      (function (card) {
        if (card.dataset.aiGuide) return;
        var hd = card.querySelector('.steps-hd');
        if (!hd) return;
        card.dataset.aiGuide = '1';
        var hide = [hd].concat(Array.prototype.slice.call(card.querySelectorAll('.step')));
        hide.forEach(function (el) { el.style.display = 'none'; });
        var label = hd.textContent.trim().replace(/^[^\u4e00-\u9fffA-Za-z]+/, '') || '解题思路';
        hd.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px">' +
          '<span style="display:inline-flex;color:#6B46C1;animation:aiPulse 2s ease-in-out infinite;transform-origin:center">' + SPARK + '</span>' +
          '<span style="font-size:14px;font-weight:700;letter-spacing:3px;background:linear-gradient(135deg,#1a365d,#6B46C1);-webkit-background-clip:text;background-clip:text;color:transparent">' + label + '</span></span>';
        hd.style.background = 'linear-gradient(135deg,#F7FAFF,#FAF5FF)';
        hd.style.borderBottom = '1px solid #E9D8FD';
        var g = document.createElement('div');
        g.className = 'ai-guide';
        g.innerHTML = '<span class="gic">' + SPARK + '</span><span>先自己读题读原文，准备好了点我 \u2014\u2014 AI 带你一步步找对解题思路</span>';
        g.addEventListener('click', function () {
          g.style.opacity = '0';
          setTimeout(function () { g.remove(); }, 300);
          hide.forEach(function (el) { el.style.display = ''; });
          setTimeout(function () {
            try { hd.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { hd.scrollIntoView(); }
          }, 120);
        });
        card.insertBefore(g, card.firstElementChild);
      })(cards[k]);
    }
  }
  setupGuides();
  var gtry = 0;
  var giv = setInterval(function () {
    setupGuides();
    if (++gtry > 10) clearInterval(giv);
  }, 400);

  /* ---------- 音效（Web Audio 合成） ---------- */
  var actx = null;
  function tone(seq) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var t0 = actx.currentTime;
      seq.forEach(function (s) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = s[0];
        g.gain.setValueAtTime(0.0001, t0 + s[1]);
        g.gain.exponentialRampToValueAtTime(0.14, t0 + s[1] + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + s[1] + s[2]);
        o.connect(g); g.connect(actx.destination);
        o.start(t0 + s[1]); o.stop(t0 + s[1] + s[2] + 0.05);
      });
    } catch (e) {}
  }
  function soundRight() { tone([[523.25, 0, 0.12], [783.99, 0.1, 0.2]]); }
  function soundWrong() { tone([[220, 0, 0.16], [174.6, 0.13, 0.22]]); }

  /* ---------- 顶部提示条 ---------- */
  function toast(msg) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);max-width:88%;background:#1a365d;color:#fff;padding:10px 18px;border-radius:22px;font-size:13px;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.25);line-height:1.6';
    document.body.appendChild(d);
    setTimeout(function () {
      d.style.transition = 'opacity .5s'; d.style.opacity = '0';
      setTimeout(function () { d.remove(); }, 500);
    }, 5000);
  }

  /* ---------- 错误模式即时分析（本地） ---------- */
  var ERR_HINTS = {
    'NOT GIVEN>FALSE': '都把"原文未提及"判成了 FALSE \u2014\u2014 记住：原文没提到 \u2260 原文说错了，完全未提及才是 NOT GIVEN',
    'NOT GIVEN>TRUE': '都犯了"过度推断" \u2014\u2014 原文没说的内容，不能自己脑补成对的',
    'FALSE>TRUE': '都没识别出题干与原文的矛盾点 \u2014\u2014 别被相似的词面骗过，逐点比对语义',
    'FALSE>NOT GIVEN': '原文其实提到了，只是说法相反 \u2014\u2014 先定位证据句，再下结论',
    'TRUE>NOT GIVEN': '都没认出同义改写 \u2014\u2014 原文换了说法不等于没提到',
    'TRUE>FALSE': '比对时注意否定词和程度词 \u2014\u2014 别把语义一致看成矛盾'
  };
  function errHint() {
    var wrongs = results.filter(function (r) { return !r.right; }).slice(-2);
    if (wrongs.length < 2) return '';
    var k1 = wrongs[0].correct + '>' + wrongs[0].chosen;
    var k2 = wrongs[1].correct + '>' + wrongs[1].chosen;
    if (k1 === k2 && ERR_HINTS[k1]) return '这两题' + ERR_HINTS[k1];
    if (wrongs[0].correct === wrongs[1].correct) return '两题都错在 ' + wrongs[0].correct + ' 类判断上 \u2014\u2014 看看 AI 讲解，找出共同的坑';
    return '先把这两题的 AI 错因讲解看完再继续，效果会好很多';
  }

  /* ---------- 本机成绩留存（目录页展示用） ---------- */
  function saveScore() {
    try {
      var r = results.filter(function (x) { return x.right; }).length;
      var t = results.length;
      var key = 'rj:' + EXAM.id;
      var old = JSON.parse(localStorage.getItem(key) || 'null') || {};
      var best = Math.max(r, old.best || 0);
      localStorage.setItem(key, JSON.stringify({ r: r, t: t, best: best, ts: Date.now() }));
    } catch (e) {}
  }


  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.abtn') : null;
    if (!btn) return;
    setTimeout(function () {
      var right = btn.classList.contains('correct');
      var wrong = btn.classList.contains('wrong');
      if (!right && !wrong) return;
      var card = btn.closest('.qcard');
      if (!card || card.dataset.aiSeen) return;
      card.dataset.aiSeen = '1';
      var cards = Array.prototype.slice.call(document.querySelectorAll('.qcard'));
      var q = EXAM.questions[cards.indexOf(card)];
      if (!q) return;
      results.push({
        qid: String(q.num),
        statement: stripTags(q.text),
        correct: norm(q.answer),
        chosen: norm(btn.textContent),
        right: !!right
      });
      if (right) {
        soundRight();
        wrongStreak = 0;
        rightStreak++;
        if (rightStreak === 3) toast('三连对！\u2728 状态正佳，保持这个节奏');
        else if (rightStreak === 5) toast('五连对！\uD83D\uDD25 这套思路你已经吃透了');
        else if (rightStreak === 8) toast('八连对！\uD83C\uDFC6 稳得可怕，冲满分');
      } else {
        soundWrong();
        rightStreak = 0;
        wrongStreak++;
        if (wrongStreak === 2) toast('连续两题失手了，别急 \uD83D\uDCAA ' + errHint());
        else if (wrongStreak === 3) toast('停一停 \uD83C\uDF31 把这几题的 AI 讲解都看完再继续，磨刀不误砍柴工');
        injectExplain(card, q, btn);
      }
      if (results.length >= EXAM.questions.length) { saveScore(); watchScore(); }
    }, 350);
  });

  /* ---------- AI 错因讲解（浅色幽灵按钮） ---------- */
  function injectExplain(card, q, btn) {
    var sec = card.querySelector('.answer-sec') || card;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:12px';
    var b = document.createElement('button');
    b.className = 'ai-btn-ghost';
    setBtn(b, SPARK, 'AI 讲解我的错因');
    wrap.appendChild(b); sec.appendChild(wrap);
    b.addEventListener('click', function () {
      b.disabled = true;
      b.classList.add('ai-spin');
      setBtn(b, SPARK, 'AI 正在分析你的错因\u2026');
      fetch(API_EXPLAIN, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setId: EXAM.id, qid: String(q.num),
          statement: stripTags(q.text), evidence: evidenceOf(q),
          correct: norm(q.answer), chosen: norm(btn.textContent)
        })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.explanation) throw new Error(j.message || 'unavailable');
        var c = aiCard();
        wrap.appendChild(c); b.style.display = 'none';
        typewriter(c._body, j.explanation);
      }).catch(function () {
        b.disabled = false;
        b.classList.remove('ai-spin');
        setBtn(b, SPARK, 'AI 讲解暂时不可用，点击重试');
      });
    });
  }

  /* ---------- AI 学情诊断（深色主按钮，呼吸光） ---------- */
  function watchScore() {
    if (summaryInjected) return;
    var n = 0;
    var iv = setInterval(function () {
      var sc = document.querySelector('.score.show');
      if (sc) { clearInterval(iv); injectSummary(sc); }
      else if (++n > 120) clearInterval(iv);
    }, 500);
  }
  function injectSummary(sc) {
    if (summaryInjected) return;
    summaryInjected = true;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:18px;text-align:left';
    var holder = document.createElement('div');
    holder.style.cssText = 'text-align:center';
    var b = document.createElement('button');
    b.className = 'ai-btn-primary';
    setBtn(b, SPARK, '生成 AI 学情诊断');
    holder.appendChild(b);
    wrap.appendChild(holder); sc.appendChild(wrap);
    b.addEventListener('click', function () {
      b.disabled = true;
      b.classList.add('ai-spin');
      setBtn(b, SPARK, 'AI 正在诊断你的错误模式\u2026');
      fetch(API_SUMMARY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setId: EXAM.id, results: results })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.summary) throw new Error(j.message || 'unavailable');
        var c = aiCard();
        wrap.appendChild(c); holder.style.display = 'none';
        typewriter(c._body, j.summary, 14);
      }).catch(function () {
        b.disabled = false;
        b.classList.remove('ai-spin');
        setBtn(b, SPARK, '诊断暂时不可用，点击重试');
      });
    });
  }

  /* ---------- 点词释义 ---------- */
  var pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function wordAt(x, y) {
    if (!document.caretRangeFromPoint) return null;
    var range = document.caretRangeFromPoint(x, y);
    if (!range) return null;
    var node = range.startContainer;
    if (!node || node.nodeType !== 3) return null;
    var text = node.textContent, i = range.startOffset;
    var L = i, R = i;
    while (L > 0 && /[A-Za-z'-]/.test(text[L - 1])) L--;
    while (R < text.length && /[A-Za-z'-]/.test(text[R])) R++;
    var word = text.slice(L, R).replace(/^['-]+|['-]+$/g, '');
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(word) || word.length < 2) return null;
    var sentEl = node.parentElement ? node.parentElement.closest('.sent,.qtext,.sinner,.mitem,.ai-dict-zone') : null;
    return { word: word, sentence: sentEl ? sentEl.textContent.trim() : '' };
  }
  function speak(w) {
    try {
      var u = new SpeechSynthesisUtterance(w);
      u.lang = 'en-US'; u.rate = 0.85;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    if (pop && !pop.contains(e.target)) closePop();
    var zone = e.target && e.target.closest ? e.target.closest('.passage-body,.qtext,.scontent,.ai-dict-zone') : null;
    if (!zone) return;
    if (e.target.closest('.passage-head')) return;
    var hit = wordAt(e.clientX, e.clientY);
    if (!hit) return;
    showPop(hit.word, hit.sentence, e.clientX, e.clientY);
  });
  function showPop(word, sentence, x, y) {
    closePop();
    pop = document.createElement('div');
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.min(Math.max(8, x - 120), vw - 268);
    var top = (y + 170 > vh) ? (y - 160) : (y + 16);
    pop.style.cssText = 'position:fixed;left:' + left + 'px;top:' + top + 'px;z-index:9999;background:#fff;border:1px solid #D6BCFA;border-radius:12px;box-shadow:0 10px 30px rgba(85,60,154,.22);padding:12px 14px;font-size:13px;width:252px;line-height:1.7';
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
    var w = document.createElement('b');
    w.textContent = word;
    w.style.cssText = 'font-size:16px;color:#1a365d';
    var sp = document.createElement('button');
    sp.textContent = '\uD83D\uDD0A';
    sp.style.cssText = 'border:none;background:#EBF4FF;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:13px';
    sp.onclick = function (ev) { ev.stopPropagation(); speak(word); };
    head.appendChild(w); head.appendChild(sp);
    var mean = document.createElement('div');
    mean.textContent = '查询中\u2026';
    mean.style.cssText = 'color:#2D3748';
    var tg = document.createElement('div');
    tg.innerHTML = SPARK.replace('width="15" height="15"', 'width="9" height="9"') + ' AI生成';
    tg.style.cssText = 'margin-top:6px;font-size:10px;color:#A0AEC0;display:inline-flex;align-items:center;gap:4px';
    pop.appendChild(head); pop.appendChild(mean); pop.appendChild(tg);
    document.body.appendChild(pop);
    speak(word);
    fetch(API_WORD, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: word, sentence: sentence })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!pop) return;
      var line = '';
      if (j.phonetic) line += '/' + String(j.phonetic).replace(/^\/+|\/+$/g, '') + '/  ';
      if (j.pos) line += j.pos + '. ';
      line += (j.meaning || '暂无释义');
      mean.textContent = line;
    }).catch(function () { if (pop) mean.textContent = '释义暂时不可用'; });
  }

  /* ---------- 做题个性化分析（右下角浮动面板） ---------- */
  function typeStats() {
    var st = { 'TRUE': [0, 0], 'FALSE': [0, 0], 'NOT GIVEN': [0, 0] };
    results.forEach(function (r) {
      if (!st[r.correct]) st[r.correct] = [0, 0];
      st[r.correct][1]++;
      if (r.right) st[r.correct][0]++;
    });
    return st;
  }
  function chip(label, val, color) {
    return '<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:16px;background:#fff;border:1px solid #e8e5df;font-size:12px;font-weight:600;color:' + color + '">' + label + ' ' + val + '</span>';
  }
  function initAnalysis() {
    var fb = document.createElement('button');
    fb.innerHTML = SPARK + '<span style="margin-left:6px">个性化分析</span>';
    fb.style.cssText = 'position:fixed;right:14px;bottom:18px;z-index:9000;display:inline-flex;align-items:center;padding:11px 16px;border:none;border-radius:24px;background:linear-gradient(135deg,#1a365d,#553C9A);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;animation:aiBreath 3s ease-in-out infinite';
    document.body.appendChild(fb);
    var mask = null;
    function close() {
      if (mask) { mask.remove(); mask = null; }
      var dr = document.getElementById('ai-ana-drawer');
      if (dr) dr.remove();
    }
    fb.addEventListener('click', function () {
      if (mask) { close(); return; }
      mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9500';
      mask.onclick = close;
      var drawer = document.createElement('div');
      drawer.id = 'ai-ana-drawer';
      drawer.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:72vh;background:#FAFAF7;z-index:9600;border-radius:16px 16px 0 0;display:flex;flex-direction:column;box-shadow:0 -8px 30px rgba(0,0,0,.25)';
      var hd = document.createElement('div');
      hd.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e8e5df;font-size:14px;font-weight:700;color:#1a365d;background:#fff;border-radius:16px 16px 0 0';
      var ttl = document.createElement('span');
      ttl.innerHTML = SPARK + ' 做题个性化分析';
      ttl.style.cssText = 'display:inline-flex;align-items:center;gap:6px;color:#553C9A';
      var cls = document.createElement('button');
      cls.textContent = '\u2715';
      cls.style.cssText = 'border:none;background:#F7F7F5;border-radius:50%;width:28px;height:28px;cursor:pointer';
      cls.onclick = close;
      hd.appendChild(ttl); hd.appendChild(cls);
      var bd = document.createElement('div');
      bd.style.cssText = 'flex:1;overflow-y:auto;padding:16px';
      drawer.appendChild(hd); drawer.appendChild(bd);
      document.body.appendChild(mask); document.body.appendChild(drawer);
      renderAnalysis(bd, close);
    });
  }
  function renderAnalysis(bd, close) {
    bd.innerHTML = '';
    if (!results.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:60px 24px;color:#888;font-size:13px;line-height:2';
      empty.innerHTML = '<div style="font-size:34px;margin-bottom:10px">\u2728</div>先去做几道题<br>答过的题会在这里实时生成你的个性化分析';
      bd.appendChild(empty);
      return;
    }
    var rightN = results.filter(function (r) { return r.right; }).length;
    var pct = Math.round(rightN / results.length * 100);
    var pctColor = pct >= 80 ? '#276749' : (pct >= 60 ? '#975A16' : '#9B2C2C');
    var top = document.createElement('div');
    top.style.cssText = 'background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);margin-bottom:12px';
    var st = typeStats();
    function typeLine(name) {
      var s = st[name];
      if (!s[1]) return '';
      var c = s[0] === s[1] ? '#276749' : (s[0] / s[1] >= 0.5 ? '#975A16' : '#9B2C2C');
      return chip(name, s[0] + '/' + s[1], c);
    }
    top.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px">' +
      '<span style="font-size:30px;font-weight:700;color:' + pctColor + '">' + pct + '%</span>' +
      '<span style="font-size:13px;color:#5a5a5a">已答 ' + results.length + ' 题 · 答对 ' + rightN + ' 题</span></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' + typeLine('TRUE') + typeLine('FALSE') + typeLine('NOT GIVEN') + '</div>';
    bd.appendChild(top);
    var wrongs = results.filter(function (r) { return !r.right; });
    var sec = document.createElement('div');
    sec.style.cssText = 'background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);margin-bottom:12px';
    if (!wrongs.length) {
      sec.innerHTML = '<div style="text-align:center;color:#276749;font-size:13px;font-weight:600;padding:6px">目前全对，太棒了 \uD83C\uDFC6</div>';
    } else {
      var h = document.createElement('div');
      h.textContent = '错题回顾（点击跳回该题）';
      h.style.cssText = 'font-size:12px;font-weight:700;color:#5a5a5a;margin-bottom:10px';
      sec.appendChild(h);
      wrongs.forEach(function (r) {
        var it = document.createElement('div');
        it.style.cssText = 'padding:10px 12px;border:1px solid #FED7D7;background:#FFF5F5;border-radius:8px;margin-bottom:8px;font-size:12px;line-height:1.7;cursor:pointer';
        var stmt = r.statement.length > 52 ? r.statement.slice(0, 52) + '\u2026' : r.statement;
        it.innerHTML = '<div style="font-weight:600;color:#1a1a1a;margin-bottom:3px">Q' + r.qid + ' · ' + stmt + '</div>' +
          '<div><span style="color:#9B2C2C">你选 ' + r.chosen + '</span><span style="color:#888"> \u2192 </span><span style="color:#276749">正确 ' + r.correct + '</span></div>';
        it.addEventListener('click', function () {
          var dots = document.querySelectorAll('.dot');
          var idx = parseInt(r.qid, 10) - 1;
          if (dots[idx]) dots[idx].click();
          close();
        });
        sec.appendChild(it);
      });
    }
    bd.appendChild(sec);
    var diagWrap = document.createElement('div');
    diagWrap.style.cssText = 'text-align:center;padding:4px 0 20px';
    var b = document.createElement('button');
    b.className = 'ai-btn-primary';
    setBtn(b, SPARK, '生成 AI 综合诊断');
    diagWrap.appendChild(b);
    bd.appendChild(diagWrap);
    b.addEventListener('click', function () {
      b.disabled = true;
      b.classList.add('ai-spin');
      setBtn(b, SPARK, 'AI 正在诊断你的做题模式\u2026');
      fetch(API_SUMMARY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setId: EXAM.id, results: results })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.summary) throw new Error(j.message || 'unavailable');
        var c = aiCard();
        c.style.textAlign = 'left';
        diagWrap.appendChild(c);
        b.style.display = 'none';
        typewriter(c._body, j.summary, 14);
      }).catch(function () {
        b.disabled = false;
        b.classList.remove('ai-spin');
        setBtn(b, SPARK, '诊断暂时不可用，点击重试');
      });
    });
  }
  initAnalysis();
})();
