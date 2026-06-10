# 后端接口实现（Node.js + Express + 通义千问）

以下为系统四个 AI 接口的完整实现，追加至 Express 服务即可。
密钥通过环境变量注入：`const AI_QWEN_KEY = process.env.QWEN_API_KEY;`（示例中请自行替换密钥读取行，切勿硬编码提交）。

```js
const AI_HTTPS = require('https');
const AI_QWEN_KEY = process.env.QWEN_API_KEY || '';
```

## 1. /api/review/ai-explain — AI 错因讲解

系统提示词（核心教学法注入）：

> 你是自学考试英语（专升本）阅读判断题型的辅导教师，使用"两层定位法"教学：第一层在原文中定位与题干对应的证据句，第二层比对题干与证据句之间的语义映射关系，据此判断 TRUE / FALSE / NOT GIVEN。学生刚刚做错了一道题。请针对"这名学生为什么会作出这个错误判断"进行诊断讲解……（先点明错误原因→带学生走两层定位→200字内→语气鼓励）

接口逻辑：校验字段 → 按 IP 限流（6次/分钟）→ 以"套号:题号:错误选项"为键做内存缓存 → 调用 qwen-plus 生成 → 返回 `{explanation}`。

## 2. /api/review/ai-summary — AI 学情诊断
## 3. /api/review/word-lookup — 点词释义

```js
// ===== AI v2: 学情诊断 + 点词释义 (2026-06-10) =====
const AI2_RATE = new Map();
function AI2_limited(req, res, max) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';
  const now = Date.now();
  const hits = (AI2_RATE.get(ip) || []).filter(t => now - t < 60000);
  if (hits.length >= max) {
    res.status(429).json({ error: 'rate_limited', message: '请求太频繁，请稍后再试' });
    return true;
  }
  hits.push(now); AI2_RATE.set(ip, hits);
  return false;
}
function AI2_call(sys, user, model, maxTokens, cb) {
  const payload = JSON.stringify({ model: model, max_tokens: maxTokens, temperature: 0.3,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] });
  const rq = AI_HTTPS.request({ hostname: 'dashscope.aliyuncs.com',
    path: '/compatible-mode/v1/chat/completions', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI_QWEN_KEY,
      'Content-Length': Buffer.byteLength(payload) } }, r2 => {
    let d = '';
    r2.on('data', x => d += x);
    r2.on('end', () => {
      try {
        const j = JSON.parse(d);
        const t = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!t) throw new Error('empty:' + d.slice(0, 120));
        cb(null, t);
      } catch (e) { cb(e); }
    });
  });
  rq.on('error', e => cb(e));
  rq.write(payload); rq.end();
}

const AI2_SUM_SYS = '你是自学考试英语（专升本）阅读判断题型的辅导教师，教学法为"两层定位法"（第一层在原文定位证据句，第二层比对题干与证据句的语义映射）。学生刚完成一套训练，下面是每题的题干、正确答案、学生选择与对错。请输出学情诊断，结构：\n1.总体表现（一句话，含答对题数）；\n2.错误模式分析：指出学生在 TRUE / FALSE / NOT GIVEN 三类判断中哪类最容易错，并结合具体题目点出最突出的1-2种陷阱模式（如：同义改写未识别、范围或程度被偷换、把"原文未提及"误判为FALSE、过度推断等）；\n3.强项肯定（一句话）；\n4.两条具体的下一步训练建议。\n用中文，280字以内，语气鼓励，不指责。';
const AI2_SUM_CACHE = new Map();

app.post('/api/review/ai-summary', (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.results) || !b.results.length) return res.status(400).json({ error: 'missing_fields' });
  if (!AI_QWEN_KEY) return res.status(500).json({ error: 'no_key' });
  if (AI2_limited(req, res, 6)) return;
  const ck = 'sum:' + b.setId + ':' + b.results.map(r => (r.chosen || '?')[0] + (r.right ? '1' : '0')).join('');
  if (AI2_SUM_CACHE.has(ck)) return res.json({ summary: AI2_SUM_CACHE.get(ck), cached: true });
  const lines = b.results.map((r, i) =>
    (i + 1) + '. 题干：' + r.statement + '｜正确答案：' + r.correct + '｜学生选择：' + r.chosen + '｜' + (r.right ? '答对' : '答错'));
  const userMsg = '套题：' + (b.setId || '') + '\n' + lines.join('\n');
  AI2_call(AI2_SUM_SYS, userMsg, 'qwen-plus', 600, (err, text) => {
    if (err) {
      console.error('[ai-summary]', err.message);
      return res.status(502).json({ error: 'ai_unavailable', message: '诊断暂时不可用，请稍后再试' });
    }
    if (AI2_SUM_CACHE.size > 300) AI2_SUM_CACHE.clear();
    AI2_SUM_CACHE.set(ck, text);
    res.json({ summary: text, cached: false });
  });
});

const AI2_WORD_SYS = '你是英语词典助手。给出用户询问的单词在给定句子语境下的信息。只返回JSON，格式严格为：{"phonetic":"美式音标(不带斜杠)","pos":"词性缩写","meaning":"中文释义,语境义优先,12字以内"}。不要输出任何JSON以外的文字。';
const AI2_WORD_CACHE = new Map();

app.post('/api/review/word-lookup', (req, res) => {
  const b = req.body || {};
  const word = String(b.word || '').trim();
  if (!word || word.length > 40) return res.status(400).json({ error: 'missing_fields' });
  if (!AI_QWEN_KEY) return res.status(500).json({ error: 'no_key' });
  if (AI2_limited(req, res, 20)) return;
  const ck = 'w:' + word.toLowerCase();
  if (AI2_WORD_CACHE.has(ck)) return res.json(Object.assign({ word: word, cached: true }, AI2_WORD_CACHE.get(ck)));
  const userMsg = '单词：' + word + '\n句子：' + String(b.sentence || '').slice(0, 300);
  AI2_call(AI2_WORD_SYS, userMsg, 'qwen-turbo', 120, (err, text) => {
    if (err) {
      console.error('[word-lookup]', err.message);
      return res.status(502).json({ error: 'ai_unavailable', message: '释义暂时不可用' });
    }
    let info;
    try {
      info = JSON.parse(String(text).replace(/```json|```/g, '').trim());
    } catch (e) {
      info = { meaning: String(text).slice(0, 60) };
    }
    if (AI2_WORD_CACHE.size > 2000) AI2_WORD_CACHE.clear();
    AI2_WORD_CACHE.set(ck, info);
    res.json(Object.assign({ word: word, cached: false }, info));
  });
});
console.log('[ai-v2] summary + word-lookup routes registered');
```


## 4. /api/review/ai-chat — AI 答疑助教（方法论内置）

```js
// ===== AI v3: 目录页AI答疑对话 (2026-06-10) =====
const AI3_CHAT_SYS = '你是自学考试英语（专升本）（13000）阅读判断题型的AI助教，教学体系为"两层定位法"：第一层用题干关键词在原文定位证据句（有数字优先用数字定位，有专有名词用专有名词定位，只有概念词则列出3-5个近义词扫读），第二层比对题干与证据句的语义映射关系，判断TRUE/FALSE/NOT GIVEN。\n核心判断标准：\n【TRUE=同义对应】题干与原文说的是同一件事，只是换了说法。常见形式：同义词替换（famous≈well-known）、同根词与词性转换（healthy↔health）、正话反说（should+正面≈don\u2019t+负面）、概括与列举互证、逻辑推导、数字时间转换（a decade=10年）、代词指代、近原文复现。\n【FALSE=有明确反面证据】题干与原文含义直接矛盾，且原文有证据支持相反说法。常见形式：反义词（same✗different）、方向颠倒（healthier✗less healthy）、否定偷换（already exists✗still a dream）、主语偷换、动作/地点/原因/频率/状态偷换、范围扩大（only some✗all）、评价颠倒。\n【NOT GIVEN=话题不在原文】题干核心概念连同义词都找不到，或题干讨论的维度原文未涉及。常见形式：核心词扫读失败、添加限定词变成新话题、常识推断陷阱（"南极=生活艰苦"是常识不是原文证据）、信息拼凑（原文分别提到A和B但没说A+B）、同词不同义、举例提及≠观点表达。\n宽严标准：同义判断从宽（well≈better不算矛盾）；判FALSE必须有反面证据——"原文没说"判NOT GIVEN，"原文说了相反的"才判FALSE。\n高频陷阱按频次：反义偷换、概念词缺失→NG、方向颠倒、否定偷换、主语偷换、范围扩大、常识推断→NG、信息拼凑→NG、限定词操作、动作主体偷换。\n回答要求：1.只回答阅读判断题型、英语学习方法、词汇语法相关的问题，无关话题礼貌引导回学习；2.用中文，简洁清晰，300字以内，多用题型术语并给具体英文例子；3.语气鼓励友好；4.不编造"原文"，不代写作业。';

app.post('/api/review/ai-chat', (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.messages) || !b.messages.length) return res.status(400).json({ error: 'missing_fields' });
  if (!AI_QWEN_KEY) return res.status(500).json({ error: 'no_key' });
  if (AI2_limited(req, res, 6)) return;
  const msgs = b.messages.slice(-8).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 500)
  })).filter(m => m.content);
  if (!msgs.length) return res.status(400).json({ error: 'missing_fields' });
  const payload = JSON.stringify({ model: 'qwen-plus', max_tokens: 700, temperature: 0.4,
    messages: [{ role: 'system', content: AI3_CHAT_SYS }].concat(msgs) });
  const rq = AI_HTTPS.request({ hostname: 'dashscope.aliyuncs.com',
    path: '/compatible-mode/v1/chat/completions', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI_QWEN_KEY,
      'Content-Length': Buffer.byteLength(payload) } }, r2 => {
    let d = '';
    r2.on('data', x => d += x);
    r2.on('end', () => {
      try {
        const j = JSON.parse(d);
        const t = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!t) throw new Error('empty:' + d.slice(0, 120));
        res.json({ reply: t });
      } catch (e) {
        console.error('[ai-chat]', e.message);
        res.status(502).json({ error: 'ai_unavailable', message: 'AI 助教暂时不可用，请稍后再试' });
      }
    });
  });
  rq.on('error', e => { console.error('[ai-chat]', e.message);
    res.status(502).json({ error: 'ai_unavailable', message: 'AI 助教暂时不可用，请稍后再试' }); });
  rq.write(payload); rq.end();
});
console.log('[ai-v3] chat route registered');
```
