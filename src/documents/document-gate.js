// CPU lexical/subword relevance heuristic. Scores are not factual confidence.
(function (root) {
  'use strict';

  const CUT_THRESHOLD = 0.60;
  const DEFAULT_MAX_CANDIDATES = 20;

  // Workspace taxonomy & synonym rewrites for Gate 2 Orbital Retry Loop
  const SYNONYM_REWRITES = [
    { pattern: /\b(?:prestage|02_prestage)\b/i, replace: 'z-live publication export' },
    { pattern: /\b(?:github_public|public_repo)\b/i, replace: 'z-live github deployment' },
    { pattern: /\b(?:farm[- ]deck|food[- ]catcher)\b/i, replace: 'myuuel Godot game' },
    { pattern: /\b(?:voice[- ]seeds?|audio[- ]seeds?)\b/i, replace: 'VoxCPM voice reference seeds' },
    { pattern: /\bworkroom\b/i, replace: 'shelved workroom context' },
    { pattern: /\b(?:chibi[- ]despill|magenta[- ]despill)\b/i, replace: 'tsuki hoshi despill matte' },
    { pattern: /\b(?:sprite[- ]scale|island[- ]lock)\b/i, replace: '4x2 sprite island scale lock' },
    { pattern: /\b(?:vram|gpu memory|memory budget)\b/i, replace: 'vram memory graphics gpu headroom budget' },
    { pattern: /\b(?:settings|config|preferences)\b/i, replace: 'settings configuration preferences modal' },
    { pattern: /\b(?:barge[- ]in|interrupt)\b/i, replace: 'hands-free full duplex barge-in interrupt' }
  ];

  const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
    'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were',
    'will', 'with', 'what', 'where', 'when', 'how', 'why', 'who', 'does', 'do',
    'did', 'can', 'could', 'should', 'would', 'about', 'tell', 'me', 'please',
    'go', 'goes', 'went', 'file', 'files', 'see', 'look', 'find', 'get', 'say',
    'says', 'said', 'document', 'passage', 'text', 'according', 'mention', 'mentioned',
    'är', 'och', 'att', 'det', 'i', 'på', 'en', 'ett', 'av', 'för', 'med', 'som', 'vad'
  ]);

  // Broad source transformations take a separate task path, not an answerability claim.
  const OVERVIEW_INTENT = /\b(?:summar(?:ize|y)|overview|explain\s+(?:this|the)\s+(?:passage|document|file|text|page|story)|what\s+is\s+this\s+(?:document|file|passage|text|page)\s+about|translate\s+this|main\s+(?:point|idea|topic|theme)s?|key\s+takeaways?|read\s+this|sammanfatta|förklara\s+texten|要約|まとめ)\b/i;

  function isOverviewQuery(query) {
    if (typeof query !== 'string') return false;
    const trimmed = query.trim();
    if (!trimmed) return true;
    if (/\b(?:and|also|plus|then|och|dessutom)\b/i.test(trimmed)) return false;
    return /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:summari[sz]e\s+(?:(?:this|the)(?: attached)? (?:document|file|passage|text|page|story)|what this (?:document|file|passage|text) is about)(?:\s+(?:in|as)\s+[^?!.]{1,60})?|translate (?:this|the)(?: attached)?(?: (?:text|document|passage))?(?: into [^?!.]{1,40})?|what is this (?:document|file|passage|text|page) about|(?:give me )?(?:an? )?(?:overview|summary) of (?:this|the) (?:document|text|passage)|sammanfatta (?:texten|dokumentet)|förklara texten|översätt (?:texten|det här)|(?:この(?:文章|文書|テキスト)を)?(?:要約|翻訳)(?:してください)?|まとめ)[.!?]*$/i.test(trimmed);

  }

  // Lightweight multilingual stemmer (English + Swedish suffixes)
  function stemToken(token) {
    if (token.length <= 3) return token;
    return token
      .replace(/(?:ationally|ization|iveness|fulness|ousness)$/i, '')
      .replace(/(?:ments|ment|ings|ing|tions|tion|sions|sion|ances|ance|ences|ence|able|ible|ness|less|arne|arna|erna|ande|ende)$/i, '')
      .replace(/(?:ed|es|er|or|ar|en|et|na|s)$/i, (m, offset) => (offset >= 3 ? '' : m));
  }

  function tokenize(text) {
    if (typeof text !== 'string' || !text) return [];
    const lower = text.toLowerCase();
    const tokens = [];

    // Extract Latin/Nordic words & numbers
    const wordMatches = lower.match(/[a-z0-9åäöéü_]+(?:-[a-z0-9åäöéü_]+)*/gi) || [];
    for (const raw of wordMatches) {
      const clean = raw.replace(/^-+|-+$/g, '');
      if (clean.length > 1 && !STOPWORDS.has(clean)) {
        tokens.push(clean);
      }
    }

    // Extract CJK character bigrams/unigrams so Japanese reading passages also score cleanly
    const cjkMatches = lower.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+/g) || [];
    for (const seq of cjkMatches) {
      if (seq.length === 1) {
        tokens.push(seq);
      } else {
        for (let i = 0; i < seq.length - 1; i++) {
          tokens.push(seq.slice(i, i + 2));
        }
      }
    }
    return tokens;
  }

  // Character 3-grams for subword & typo resilience in the CPU reranker
  function charTrigrams(text) {
    const clean = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const set = new Set();
    if (clean.length < 3) {
      if (clean) set.add(clean);
      return set;
    }
    for (let i = 0; i <= clean.length - 3; i++) {
      set.add(clean.slice(i, i + 3));
    }
    return set;
  }

  // Split raw document or reading text into up to maxCandidates overlapping passages
  function chunkDocument(rawText, { idPrefix = 'chunk', maxCandidates = DEFAULT_MAX_CANDIDATES, chunkChars = 480, overlapChars = 96 } = {}) {
    if (typeof rawText !== 'string' || !rawText.trim()) return [];
    const normalized = rawText.replace(/\r\n/g, '\n').trim();
    const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    const chunks = [];
    let buffer = '';

    const pushChunk = text => {
      const t = text.trim();
      if (!t) return;
      chunks.push({
        id: `${idPrefix}-${chunks.length + 1}`,
        unit: chunks.length + 1,
        text: t
      });
    };

    for (const para of paragraphs) {
      if ((buffer ? buffer.length + 2 + para.length : para.length) <= chunkChars) {
        buffer = buffer ? `${buffer}\n\n${para}` : para;
      } else {
        if (buffer) pushChunk(buffer);
        if (para.length <= chunkChars) {
          buffer = para;
        } else {
          // Slice long paragraph with overlap
          const step = Math.max(120, chunkChars - overlapChars);
          for (let start = 0; start < para.length && chunks.length < maxCandidates; start += step) {
            pushChunk(para.slice(start, start + chunkChars));
          }
          buffer = '';
        }
      }
      if (chunks.length >= maxCandidates) break;
    }
    if (buffer && chunks.length < maxCandidates) pushChunk(buffer);
    return chunks.slice(0, maxCandidates);
  }

  function rewriteQuery(query) {
    if (typeof query !== 'string' || !query.trim()) return null;
    let rewritten = query;
    let modified = false;
    for (const rule of SYNONYM_REWRITES) {
      if (rule.pattern.test(rewritten)) {
        rewritten = rewritten.replace(rule.pattern, rule.replace);
        modified = true;
      }
    }
    // Also append stemmed root tokens if not already present
    const tokens = tokenize(query);
    const stems = [];
    for (const t of tokens) {
      const s = stemToken(t);
      if (s && s.length >= 3 && s !== t && !tokens.includes(s)) {
        stems.push(s);
      }
    }
    if (stems.length) {
      rewritten = `${rewritten} ${stems.join(' ')}`;
      modified = true;
    }
    return modified ? rewritten.trim() : null;
  }

  // Gate 1 + Gate 2 CPU Cross-Feature Scorer:
  // Combines exact/stemmed token recall, BM25 saturation, char-3gram subword similarity,
  // and ordered sliding-window phrase proximity.
  function scorePassage(queryTokens, passageText, idfMap = null) {
    if (!queryTokens.length || !passageText) return 0.1;
    const passageTokens = tokenize(passageText);
    if (!passageTokens.length) return 0.1;

    const passageFreq = new Map();
    const passageStems = new Set();
    for (const pt of passageTokens) {
      passageFreq.set(pt, (passageFreq.get(pt) || 0) + 1);
      passageStems.add(stemToken(pt));
    }

    const lowerPassage = passageText.toLowerCase();
    const k1 = 1.2;
    const b = 0.65;
    const avgDl = 48;
    const dl = passageTokens.length;

    let exactMatches = 0;
    let stemMatches = 0;
    let substringMatches = 0;
    let bm25Sum = 0;
    let totalWeight = 0;

    for (const qToken of queryTokens) {
      const qStem = stemToken(qToken);
      const idf = idfMap?.get(qToken) ?? 1.0;
      totalWeight += idf;

      const tf = passageFreq.get(qToken) || 0;
      if (tf > 0) {
        exactMatches++;
        const normTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl)));
        bm25Sum += idf * Math.min(1.35, normTf);
      } else if (qStem.length >= 3 && passageStems.has(qStem)) {
        stemMatches++;
        bm25Sum += idf * 0.82;
      } else if (qToken.length >= 4 && lowerPassage.includes(qToken)) {
        substringMatches++;
        bm25Sum += idf * 0.72;
      }
    }

    // Gate 2 Feature A: Ordered / windowed phrase proximity bonus
    let proximityBonus = 0;
    if (queryTokens.length >= 2 && (exactMatches + stemMatches) >= 2) {
      const hitPositions = [];
      for (let idx = 0; idx < passageTokens.length; idx++) {
        const pt = passageTokens[idx];
        const pStem = stemToken(pt);
        if (queryTokens.some(qt => qt === pt || (stemToken(qt).length >= 3 && stemToken(qt) === pStem))) {
          hitPositions.push(idx);
        }
      }
      if (hitPositions.length >= 2) {
        let minSpan = Infinity;
        for (let i = 1; i < hitPositions.length; i++) {
          minSpan = Math.min(minSpan, hitPositions[i] - hitPositions[i - 1]);
        }
        if (minSpan <= 3) proximityBonus = 0.14;
        else if (minSpan <= 8) proximityBonus = 0.08;
      }
    }

    // Gate 2 Feature B: Character 3-gram subword overlap
    const qTrigrams = charTrigrams(queryTokens.join(' '));
    const pTrigrams = charTrigrams(passageText);
    let triHits = 0;
    for (const tri of qTrigrams) {
      if (pTrigrams.has(tri)) triHits++;
    }
    const trigramRatio = qTrigrams.size ? triHits / qTrigrams.size : 0;

    const matchedWeight = exactMatches * 1.3 + stemMatches * 0.95 + substringMatches * 0.8;
    const effectiveTokens = Math.max(1.6, Math.min(queryTokens.length, 5));
    const coverageRatio = Math.min(1.0, matchedWeight / effectiveTokens);
    const bm25Ratio = totalWeight > 0 ? Math.min(1.0, bm25Sum / Math.max(1.5, totalWeight * 0.85)) : 0;

    const combined = coverageRatio * 0.58 + bm25Ratio * 0.27 + trigramRatio * 0.15 + proximityBonus;
    const score = Math.min(0.98, Math.max(0.08, 0.16 + combined * 0.82));
    return parseFloat(score.toFixed(3));
  }

  function scoreCandidatePool(query, candidatePassages) {
    const qTokens = tokenize(query);
    // Normalize passages: auto-chunk any single passage that is very long (>900 chars)
    const expanded = [];
    for (let i = 0; i < candidatePassages.length; i++) {
      const item = candidatePassages[i];
      const text = typeof item === 'string' ? item : item?.text || '';
      const id = typeof item === 'object' && item?.id ? item.id : `chunk-${i + 1}`;
      if (text.length > 900 && candidatePassages.length < 6) {
        expanded.push(...chunkDocument(text, { idPrefix: id, maxCandidates: DEFAULT_MAX_CANDIDATES }));
      } else if (text.trim()) {
        expanded.push({
          id,
          unit: typeof item === 'object' && item?.unit ? item.unit : expanded.length + 1,
          text
        });
      }
    }

    // Compute lightweight corpus IDF across candidate pool
    const idfMap = new Map();
    const N = Math.max(1, expanded.length);
    for (const qt of qTokens) {
      let df = 0;
      for (const p of expanded) {
        if (p.text.toLowerCase().includes(qt)) df++;
      }
      idfMap.set(qt, Math.log(1 + (N - df + 0.5) / (df + 0.5)) * 0.5 + 0.75);
    }

    const scored = expanded.map((p, idx) => {
      const score = scorePassage(qTokens, p.text, idfMap);
      return {
        id: p.id || `chunk-${idx + 1}`,
        unit: p.unit || idx + 1,
        text: p.text,
        score
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return { qTokens, scored, totalCandidates: expanded.length };
  }

  // Optional WebSocket hardware bridge
  let activeWebSocket = null;
  let wsConnected = false;

  function initWebSocketBridge(wsUrl = 'ws://127.0.0.1:8795/ws', {enabled=false} = {}) {
    if(!enabled)return false;
    if (typeof root.WebSocket === 'undefined' && typeof WebSocket === 'undefined') return;
    const WS = typeof root.WebSocket !== 'undefined' ? root.WebSocket : WebSocket;

    try {
      if (activeWebSocket) {
        try { activeWebSocket.close(); } catch {}
      }
      activeWebSocket = new WS(wsUrl);
      activeWebSocket.onopen = () => { wsConnected = true; };
      activeWebSocket.onclose = () => { wsConnected = false; };
      activeWebSocket.onerror = () => { wsConnected = false; };
    } catch {
      wsConnected = false;
    }
  }

  async function evaluateViaWebSocket(query, candidatePassages, timeoutMs = 180) {
    if (!activeWebSocket || activeWebSocket.readyState !== 1) return null;

    return new Promise(resolve => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; resolve(null); }
      }, timeoutMs);

      const handler = event => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.event === 'gate_eval') {
            resolved = true;
            clearTimeout(timer);
            activeWebSocket.removeEventListener('message', handler);
            resolve(data);
          }
        } catch {}
      };

      activeWebSocket.addEventListener('message', handler);
      try {
        activeWebSocket.send(JSON.stringify({
          action: 'evaluate',
          query,
          passages: candidatePassages.slice(0, 30)
        }));
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  async function evaluate({
    query,
    passages = [],
    threshold = CUT_THRESHOLD,
    allowRetry = true,
    useBridge = false
  } = {}) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!passages.length || !query || !query.trim()) {
      return {
        decision: 'NOT_IN_DOCS',
        gate1Pass: false,
        gate2Pass: false,
        candidates: 0,
        cut: threshold,
        gates: 2,
        retries: 0,
        retryCount: 0,
        topScore: 0.0,
        candidateScores: [],
        passages: [],
        query: query || '',
        rewrittenQuery: null,
        latencyMs: Number(((typeof performance!=='undefined'?performance.now():Date.now())-t0).toFixed(2)),
        engine: 'cpu-reranker-js'
      };
    }

    // Overview/translation is a distinct task; retain real relevance scores.
    if (isOverviewQuery(query)) {
      const { scored, totalCandidates } = scoreCandidatePool(query, passages);
      const topPassages = scored.slice(0, 4);
      const tEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return {
        decision: 'OVERVIEW',
        gate1Pass: null,
        gate2Pass: null,
        candidates: totalCandidates,
        cut: threshold,
        gates: 0,
        retries: 0,
        retryCount: 0,
        topScore: topPassages[0]?.score || 0,
        candidateScores: topPassages.slice(0, 5).map(p => p.score),
        passages: topPassages,
        query,
        rewrittenQuery: null,
        latencyMs: parseFloat((tEnd - t0).toFixed(2)),
        engine: 'cpu-reranker-overview'
      };
    }

    // Try live WebSocket bridge if connected
    if (useBridge && wsConnected) {
      const wsResult = await evaluateViaWebSocket(query, passages);
      if (wsResult) {
        const answerable = wsResult.decision === 'ANSWERABLE';
        return {
          decision: wsResult.decision || 'ANSWERABLE',
          gate1Pass: answerable,
          gate2Pass: answerable,
          candidates: wsResult.candidates || passages.length,
          cut: threshold,
          gates: 2,
          retries: wsResult.retryCount || 0,
          retryCount: wsResult.retryCount || 0,
          topScore: wsResult.topScore || 0.85,
          candidateScores: (wsResult.passages || []).slice(0, 5).map(p => p.score || 0.8),
          passages: wsResult.passages || passages.slice(0, 3),
          query,
          rewrittenQuery: wsResult.rewrittenQuery || null,
          latencyMs: parseFloat(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(2)),
          engine: 'ws-rx7900xtx'
        };
      }
    }

    // Gate 1 + Gate 2 In-Process CPU Reranker
    let rewritten = null;
    let retryCount = 0;
    let { scored, totalCandidates } = scoreCandidatePool(query, passages);

    // Gate 1: Lexical + subword retrieval filter (>= threshold * 0.82)
    const gate1Floor = parseFloat((threshold * 0.82).toFixed(3));
    let gate1Pass = scored.some(p => p.score >= gate1Floor);
    // Gate 2: Calibrated cross-feature cutoff (>= threshold)
    let passingPassages = scored.filter(p => p.score >= threshold);
    let gate2Pass = passingPassages.length > 0;

    // Orbital Query Rewrite Loop when Gate 1 or Gate 2 misses
    if ((!gate1Pass || !gate2Pass) && allowRetry) {
      const potentialRewrite = rewriteQuery(query);
      if (potentialRewrite && potentialRewrite !== query) {
        rewritten = potentialRewrite;
        retryCount = 1;
        const retryResult = scoreCandidatePool(rewritten, passages);
        const retryPassing = retryResult.scored.filter(p => p.score >= threshold);
        if (retryPassing.length > 0) {
          passingPassages = retryPassing;
          scored = retryResult.scored;
          gate1Pass = true;
          gate2Pass = true;
        }
      }
    }

    const topScore = scored.length ? scored[0].score : 0.0;
    const isAnswerable = gate1Pass && gate2Pass;
    const tEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();

    return {
      decision: isAnswerable ? 'ANSWERABLE' : 'NOT_IN_DOCS',
      gate1Pass,
      gate2Pass,
      candidates: totalCandidates,
      cut: threshold,
      gates: 2,
      retries: retryCount,
      retryCount,
      topScore,
      candidateScores: scored.slice(0, 5).map(p => p.score),
      passages: isAnswerable ? passingPassages.slice(0, 4) : [],
      query,
      rewrittenQuery: rewritten,
      latencyMs: parseFloat((tEnd - t0).toFixed(2)),
      engine: 'cpu-reranker-js'
    };
  }

  const api = {
    CUT_THRESHOLD,
    tokenize,
    stemToken,
    chunkDocument,
    isOverviewQuery,
    rewriteQuery,
    scorePassage,
    evaluate,
    initWebSocketBridge,
    get wsConnected() { return wsConnected; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiscussionDocumentGate = api;
})(typeof window === 'undefined' ? globalThis : window);
