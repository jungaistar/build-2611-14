/* 협력업체 통합 품질관리 — 판정·계산 엔진
 *
 * 화면(app.js)은 계산·판정하지 않는다. 점수식 · 판정 · 상태 · 집계 · 양식 읽기 · 메일 초안은
 * 전부 여기에 두고 test/logic.test.js 로 고정한다. 브라우저와 node 양쪽에서 읽힌다(전역 QA).
 *
 * Audit 4종 (점수식은 회사 엑셀 양식의 식을 그대로 옮겼다 — 항목·배점은 사용자가 올린 양식에서 읽는다)
 *   A 대형 제관 Audit  Level 0~3 × 가중치(CTQ 2 · 그 밖 1) → SUM(환산)/(SUM(가중치)×3)×100
 *                      ≥90 양호 · ≥75 개선요 · 그 밖 불합격
 *   C Process Audit    점수 2/1/0/N/A × 가중치 1/2 → 공정별 10점 + Grade(≥9 Green · ≥7 Yellow · Red)
 *                      총점 = SUM(환산)/(2×SUM(가중치) − 2×SUM(N/A 가중치))×100
 *   B PSO              양호·개선요·미실시 체크(점수 없음) + 상세 OK/NG/N/A(해당·제외) + Issue List
 *   D 도장 Audit       항목 배점 3/2/1, 선택지 중 평가점수 → N/A 뺀 평가점수 합 / N/A 뺀 배점 합 ×100
 *                      ≥90 우수 · ≥80 양호 · ≥70 개선 필요 · 그 밖 전면 개선 필요
 *
 * 리포에 있는 양식은 전부 지어낸 예제다(SAMPLE_FORMS). 실제 회사 양식의 항목 문장은 넣지 않는다.
 */
(function (root) {
  'use strict';

  var KINDS = {
    C: { id: 'C', name: 'Process Audit', short: 'Process', scored: true },
    A: { id: 'A', name: '대형 제관 Audit', short: '대형 제관', scored: true },
    B: { id: 'B', name: 'PSO', short: 'PSO', scored: false },
    D: { id: 'D', name: '도장 Audit', short: '도장', scored: true }
  };
  var ORDER = ['C', 'A', 'B', 'D'];           // 기획서 메뉴 순서
  var SCORED = ['C', 'A', 'D'];

  var LEVEL_GUIDE = [
    { level: 3, freq: '발생빈도 0', text: '특별한 문제 없음' },
    { level: 2, freq: '1~20%', text: '단발성 문제 · 개선 필요' },
    { level: 1, freq: '21~40%', text: '공정 문제 · 즉시 개선' },
    { level: 0, freq: '41% 이상', text: '재공·재고 전수 확인 · 선별 및 조치 협의' }
  ];
  var FINDING_TYPES = ['공정', 'CTQ', '청정도', '비파괴', '열처리', '도장', '2차 협력사', '기타'];
  var INSPECT_STATES = ['요청', '조치 중', '완료'];
  var ISSUE_STATUS = [1, 2, 3, 4];

  /* ---------- 작은 도구 ---------- */
  function num(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return v;
    var s = String(v).trim().replace(/,/g, '');
    if (s === '') return NaN;
    return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : NaN;
  }
  function isNA(v) { return typeof v === 'string' && /^n\s*\/?\s*a$/i.test(v.trim()); }
  function blank(v) { return v === null || v === undefined || String(v).trim() === ''; }
  function round1(x) { return x == null || !isFinite(x) ? null : Math.round(x * 10) / 10; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function addDays(s, n) { var p = s.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + n); return ymd(d); }
  function daysBetween(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 864e5);
  }
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function avg(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function uid(prefix) { return (prefix || 'x') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  /* ---------- 판정 ---------- */
  function judgeA(pct) { if (pct == null) return ''; return pct >= 90 ? '양호' : pct >= 75 ? '개선요' : '불합격'; }
  function judgeD(pct) { if (pct == null) return ''; return pct >= 90 ? '우수' : pct >= 80 ? '양호' : pct >= 70 ? '개선 필요' : '전면 개선 필요'; }
  function gradeC(score10, valid, entered) {
    if (!entered) return '';
    if (valid === 0) return 'N/A';
    return score10 >= 9 ? 'Green' : score10 >= 7 ? 'Yellow' : 'Red';
  }
  // 판정 낱말의 무게(좋음 0 → 나쁨 3). 화면 색과 정렬에 쓴다.
  var JUDGE_RANK = { '양호': 0, '우수': 0, 'Green': 0, '개선요': 1, 'Yellow': 1, '개선 필요': 2, '불합격': 3, 'Red': 3, '전면 개선 필요': 3 };
  function judgeTone(j) {
    var r = JUDGE_RANK[j];
    return r == null ? '' : r === 0 ? 'ok' : r === 3 ? 'bad' : 'mid';
  }

  /* ---------- 점수식 ---------- */
  // A 대형 제관: 미입력은 엑셀과 같이 0 으로 더하되 missing 으로 알린다.
  function scoreA(form, values) {
    values = values || {};
    var sumW = 0, sumC = 0, missing = 0, invalid = [], groups = [], gi = {};
    var rows = form.items.map(function (it) {
      var w = it.weight, raw = values[it.no], has = !blank(raw), L = has ? num(raw) : 0;
      if (has && !(L >= 0 && L <= 3 && L === Math.round(L))) { invalid.push(it.no); L = 0; has = false; }
      if (!has) missing++;
      var c = L * w;
      sumW += w; sumC += c;
      var g = gi[it.process];
      if (!g) { g = gi[it.process] = { name: it.process, raw: 0, max: 0, missing: 0 }; groups.push(g); }
      g.raw += c; g.max += 3 * w; if (!has) g.missing++;
      return { no: it.no, level: has ? L : null, weight: w, conv: c };
    });
    groups.forEach(function (g) { g.pct = g.max ? g.raw / g.max * 100 : null; });
    var max = sumW * 3, pct = max ? sumC / max * 100 : null;
    return { kind: 'A', raw: sumC, max: max, pct: pct, judge: judgeA(pct), missing: missing, invalid: invalid, rows: rows, groups: groups, count: form.items.length };
  }

  // C Process Audit: 공정별 총 합계 · 유효 합계 · 환산 · 10점 · Grade
  function scoreC(form, values) {
    values = values || {};
    var groups = [], gi = {}, sumW = 0, naW = 0, conv = 0, missing = 0, invalid = [];
    var rows = form.items.map(function (it) {
      var v = values[it.no], na = isNA(v), has = !blank(v) && !na, s = has ? num(v) : 0;
      if (has && [0, 1, 2].indexOf(s) < 0) { invalid.push(it.no); s = 0; has = false; }
      if (!has && !na) missing++;
      var g = gi[it.process];
      if (!g) { g = gi[it.process] = { name: it.process, sumW: 0, naW: 0, conv: 0, entered: 0 }; groups.push(g); }
      g.sumW += it.weight; sumW += it.weight;
      if (na) { g.naW += it.weight; naW += it.weight; g.entered++; }
      else { var c = s * it.weight; g.conv += c; conv += c; if (has) g.entered++; }
      return { no: it.no, score: na ? 'N/A' : has ? s : null, weight: it.weight, conv: na ? null : s * it.weight };
    });
    groups.forEach(function (g) {
      g.total = g.sumW * 2;
      g.valid = g.total - 2 * g.naW;
      g.score10 = g.valid === 0 ? 0 : g.conv / g.valid * 10;
      g.grade = gradeC(g.score10, g.valid, g.entered);
      g.raw = g.conv; g.max = g.valid;
      g.pct = g.valid ? g.conv / g.valid * 100 : null;
    });
    var den = 2 * sumW - 2 * naW, pct = den > 0 ? conv / den * 100 : null;
    var red = groups.filter(function (g) { return g.grade === 'Red'; }).length;
    return { kind: 'C', raw: conv, max: den, pct: pct, judge: '', grades: groups.map(function (g) { return g.grade; }), red: red, missing: missing, invalid: invalid, rows: rows, groups: groups, count: form.items.length };
  }

  // D 도장: N/A 를 뺀 평가점수 합 / N/A 를 뺀 배점 합
  function scoreD(form, values) {
    values = values || {};
    var earned = 0, den = 0, missing = 0, invalid = [], groups = [], gi = {};
    var rows = form.items.map(function (it) {
      var v = values[it.no], na = isNA(v), has = !blank(v) && !na, s = has ? num(v) : 0;
      if (has && (it.options.indexOf(s) < 0 || s > it.points)) { invalid.push(it.no); s = 0; has = false; }
      if (!has && !na) missing++;
      var g = gi[it.group];
      if (!g) { g = gi[it.group] = { name: it.group, raw: 0, max: 0 }; groups.push(g); }
      if (!na) { earned += s; den += it.points; g.raw += s; g.max += it.points; }
      return { no: it.no, score: na ? 'N/A' : has ? s : null, points: it.points };
    });
    groups.forEach(function (g) { g.pct = g.max ? g.raw / g.max * 100 : null; });
    var pct = den > 0 ? earned / den * 100 : null;
    return { kind: 'D', raw: earned, max: den, pct: pct, judge: judgeD(pct), missing: missing, invalid: invalid, rows: rows, groups: groups, count: form.items.length };
  }

  // B PSO: 점수 없음 — 개수와 비율만
  var B_MARKS = ['양호', '개선요', '미실시'];
  var B_RESULTS = ['OK', 'NG', 'N/A'];
  function bLists(form, stage) {
    return stage === 'PSO' ? { basic: form.psoBasic || [], detail: [] } : { basic: form.preBasic || [], detail: form.preDetail || [] };
  }
  function scoreB(form, entry) {
    entry = entry || {};
    var L = bLists(form, entry.stage), bv = entry.values || {}, dv = entry.detail || {};
    var basic = { '양호': 0, '개선요': 0, '미실시': 0, missing: 0 };
    L.basic.forEach(function (it) { var m = bv[it.no]; if (B_MARKS.indexOf(m) >= 0) basic[m]++; else basic.missing++; });
    var entered = basic['양호'] + basic['개선요'] + basic['미실시'];
    var detail = { OK: 0, NG: 0, 'N/A': 0, excluded: 0, missing: 0 };
    L.detail.forEach(function (it) {
      var d = dv[it.no] || {};
      if (d.apply === '제외') { detail.excluded++; return; }
      if (B_RESULTS.indexOf(d.res) >= 0) detail[d.res]++; else detail.missing++;
    });
    var judged = detail.OK + detail.NG;
    var issues = entry.issues || [];
    var byStatus = { 1: 0, 2: 0, 3: 0, 4: 0 };
    issues.forEach(function (x) { if (byStatus[x.status] != null) byStatus[x.status]++; });
    return {
      kind: 'B', stage: entry.stage === 'PSO' ? 'PSO' : 'Pre-PSO', pct: null, judge: '', raw: null, max: null,
      basic: basic, goodRatio: entered ? basic['양호'] / entered * 100 : null,
      detail: detail, okRatio: judged ? detail.OK / judged * 100 : null,
      issues: { count: issues.length, byStatus: byStatus },
      missing: basic.missing + detail.missing, count: L.basic.length + L.detail.length, groups: []
    };
  }

  function score(kind, form, audit) {
    if (kind === 'A') return scoreA(form, audit.values);
    if (kind === 'C') return scoreC(form, audit.values);
    if (kind === 'D') return scoreD(form, audit.values);
    if (kind === 'B') return scoreB(form, audit);
    throw new Error('알 수 없는 Audit 종류: ' + kind);
  }
  // 한 줄 요약 — 화면·엑셀·메일 공통
  function summaryText(s) {
    if (s.kind === 'B') return s.stage + ' 양호 ' + s.basic['양호'] + ' · 개선요 ' + s.basic['개선요'] + ' · 미실시 ' + s.basic['미실시'] + (s.detail.NG ? ' · 상세 NG ' + s.detail.NG : '');
    if (s.pct == null) return 'N/A';
    var t = rawText(s) + ' = ' + round1(s.pct).toFixed(1) + '점';
    if (s.kind === 'C') t += ' · Red 공정 ' + s.red + '개';
    else t += ' · ' + s.judge;
    return t;
  }
  function rawText(s) {
    if (s.kind === 'B' || s.raw == null) return '';
    var r = Math.round(s.raw * 100) / 100;
    return r + ' / ' + s.max;
  }
  function judgeOf(s) {
    if (s.kind === 'C') return s.pct == null ? 'N/A' : (s.red ? 'Red ' + s.red : 'Red 없음');
    if (s.kind === 'B') return s.basic['개선요'] + s.basic['미실시'] + s.detail.NG ? '개선요 ' + (s.basic['개선요'] + s.basic['미실시'] + s.detail.NG) : '지적 없음';
    return s.judge;
  }

  /* ---------- 이력 · 비교 ---------- */
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.round || 0) - (b.round || 0); }
  function formOf(db, audit) {
    var f = (db.forms || []).filter(function (x) { return x.id === audit.formId; })[0];
    if (!f) f = activeForm(db, audit.kind);
    return f;
  }
  function activeForm(db, kind) {
    var id = (db.activeForms || {})[kind];
    var list = (db.forms || []).filter(function (f) { return f.kind === kind; });
    return list.filter(function (f) { return f.id === id; })[0] || list[list.length - 1] || null;
  }
  function history(db, vendorId, kind) {
    return (db.audits || []).filter(function (a) { return a.vendorId === vendorId && (!kind || a.kind === kind); }).slice().sort(byDate);
  }
  function scoredHistory(db, vendorId, kind) {
    return history(db, vendorId, kind).map(function (a) { return { audit: a, s: score(a.kind, formOf(db, a), a) }; });
  }
  function nextRound(db, vendorId, kind) { return history(db, vendorId, kind).length + 1; }
  function previousOf(db, audit) {
    var h = history(db, audit.vendorId, audit.kind).filter(function (a) { return a.id !== audit.id && byDate(a, audit) < 0; });
    return h.length ? h[h.length - 1] : null;
  }
  // 이전 Audit 대비 — 같은 양식이면 항목별 변화까지, 양식이 다르면 점수만
  function compare(db, prev, cur) {
    if (!prev) return null;
    var fp = formOf(db, prev), fc = formOf(db, cur);
    var sp = score(prev.kind, fp, prev), sc = score(cur.kind, fc, cur);
    var out = { prevDate: prev.date, prevPct: sp.pct, curPct: sc.pct, delta: sp.pct != null && sc.pct != null ? sc.pct - sp.pct : null, sameForm: fp && fc && fp.id === fc.id, items: [] };
    if (cur.kind === 'B') {
      out.prevRatio = sp.goodRatio; out.curRatio = sc.goodRatio;
      out.delta = sp.goodRatio != null && sc.goodRatio != null ? sc.goodRatio - sp.goodRatio : null;
    }
    if (out.sameForm && cur.kind !== 'B') {
      fc.items.forEach(function (it) {
        var a = (prev.values || {})[it.no], b = (cur.values || {})[it.no];
        a = blank(a) ? null : isNA(a) ? 'N/A' : num(a); b = blank(b) ? null : isNA(b) ? 'N/A' : num(b);
        if (a !== b) out.items.push({ no: it.no, text: it.content || it.item, before: a, after: b, diff: typeof a === 'number' && typeof b === 'number' ? b - a : null });
      });
    }
    return out;
  }

  /* ---------- 지적사항 · 개선조치 ---------- */
  // 양식의 결과 식: 지적 없음 → 빈칸 / 계획일정 없음 → 계획 미수립 / 완료일정 없음 → 개선 진행중 / 개선 완료
  // + 기획서 요구: 품질 담당자 확인까지 추적 → 확인 완료
  var STATUS = ['계획 미수립', '개선 진행중', '개선 완료', '확인 완료'];
  function findingStatus(f) {
    if (!f || blank(f.finding)) return '';
    if (!blank(f.verifiedDate)) return '확인 완료';
    if (blank(f.planDate)) return '계획 미수립';
    if (blank(f.doneDate)) return '개선 진행중';
    return '개선 완료';
  }
  function deadlineOf(f) { return !blank(f.planDate) ? f.planDate : !blank(f.dueDate) ? f.dueDate : ''; }
  function isOverdue(f, today) {
    var s = findingStatus(f), d = deadlineOf(f);
    return (s === '계획 미수립' || s === '개선 진행중') && !!d && d < today;
  }
  function findingKey(f) {
    if (!blank(f.itemNo) && f.kind) return f.kind + '#' + f.itemNo;
    return 'P#' + (f.process || '') + '#' + (f.type || '');
  }
  // 같은 업체 · 같은 원인 항목(없으면 공정+유형)이 그 전에 지적된 적이 있으면 재발
  function recurOf(f, findings) {
    var k = findingKey(f);
    var before = (findings || []).some(function (x) {
      return x.id !== f.id && x.vendorId === f.vendorId && findingKey(x) === k && !blank(x.finding) && (x.date || '') < (f.date || '');
    });
    return before ? '재발' : '신규';
  }
  function repeatAnalysis(findings, labelOf) {
    var m = {}, list = [];
    (findings || []).forEach(function (f) {
      if (blank(f.finding)) return;
      var k = findingKey(f);
      if (!m[k]) { m[k] = { key: k, kind: f.kind || '', itemNo: f.itemNo || '', process: f.process || '', type: f.type || '', label: labelOf ? labelOf(f) : (f.process || ''), count: 0, vendors: {}, dates: [], open: 0 }; list.push(m[k]); }
      var g = m[k]; g.count++; g.vendors[f.vendorId] = 1; g.dates.push(f.date || '');
      var st = findingStatus(f); if (st === '계획 미수립' || st === '개선 진행중') g.open++;
    });
    return list.filter(function (g) { return g.count >= 2; }).map(function (g) {
      g.vendorCount = Object.keys(g.vendors).length; g.dates.sort(); g.last = g.dates[g.dates.length - 1]; return g;
    }).sort(function (a, b) { return b.count - a.count || (a.last < b.last ? 1 : -1); });
  }
  function findingCounts(findings, today) {
    var c = { total: 0, '계획 미수립': 0, '개선 진행중': 0, '개선 완료': 0, '확인 완료': 0, overdue: 0, recur: 0 };
    (findings || []).forEach(function (f) {
      var s = findingStatus(f); if (!s) return;
      c.total++; c[s]++; if (isOverdue(f, today)) c.overdue++; if (f.recur === '재발') c.recur++;
    });
    c.open = c['계획 미수립'] + c['개선 진행중'];
    c.closed = c['개선 완료'] + c['확인 완료'];
    return c;
  }

  /* ---------- 선택 조건 · 대시보드 ---------- */
  // 담당자 미선택 → 전체 / 담당자 → 그 담당자의 업체 전체 / 업체 → 그 업체 상세
  function scopeOf(db, sel) {
    sel = sel || {};
    var vendors = db.vendors || [];
    var v = sel.vendorId ? vendors.filter(function (x) { return x.id === sel.vendorId; })[0] : null;
    if (v && sel.managerId && v.managerId !== sel.managerId) v = null;     // 담당자를 바꾸면 남의 업체 선택은 풀린다
    if (v) return { mode: 'vendor', vendor: v, vendorIds: [v.id], managerId: sel.managerId || '' };
    if (sel.managerId) {
      var mine = vendors.filter(function (x) { return x.managerId === sel.managerId; });
      return { mode: 'manager', vendorIds: mine.map(function (x) { return x.id; }), managerId: sel.managerId };
    }
    return { mode: 'all', vendorIds: vendors.map(function (x) { return x.id; }), managerId: '' };
  }
  function vendorRow(db, vendorId, today) {
    var last = {}, pcts = [], n = 0;
    ORDER.forEach(function (k) {
      var h = scoredHistory(db, vendorId, k); n += h.length;
      if (!h.length) return;
      var L = h[h.length - 1], P = h.length > 1 ? h[h.length - 2] : null;
      last[k] = { date: L.audit.date, pct: L.s.pct, judge: judgeOf(L.s), delta: P && P.s.pct != null && L.s.pct != null ? L.s.pct - P.s.pct : null, ratio: L.s.goodRatio, s: L.s };
      if (KINDS[k].scored && L.s.pct != null) pcts.push(L.s.pct);
    });
    var fs = (db.findings || []).filter(function (f) { return f.vendorId === vendorId; });
    var ins = (db.inspections || []).filter(function (x) { return x.vendorId === vendorId; });
    return { vendorId: vendorId, audits: n, last: last, avgPct: avg(pcts), findings: findingCounts(fs, today), inspections: ins.length };
  }
  function dashboard(db, sel, today) {
    var sc = scopeOf(db, sel), ids = sc.vendorIds;
    var rows = ids.map(function (id) { return vendorRow(db, id, today); });
    var inScope = function (x) { return ids.indexOf(x.vendorId) >= 0; };
    var audits = (db.audits || []).filter(inScope);
    var fs = (db.findings || []).filter(inScope);
    var avgs = rows.map(function (r) { return r.avgPct; }).filter(function (x) { return x != null; });
    var byKind = {};
    ORDER.forEach(function (k) { byKind[k] = audits.filter(function (a) { return a.kind === k; }).length; });
    var out = {
      mode: sc.mode, scope: sc, rows: rows,
      kpi: { vendors: ids.length, audits: audits.length, byKind: byKind, avgPct: avg(avgs), findings: findingCounts(fs, today), inspections: (db.inspections || []).filter(inScope).length }
    };
    if (sc.mode === 'vendor') {
      var vid = sc.vendor.id;
      out.detail = {
        byKind: ORDER.map(function (k) { return { kind: k, list: scoredHistory(db, vid, k) }; }),
        series: series(db, vid),
        open: fs.filter(function (f) { var s = findingStatus(f); return s === '계획 미수립' || s === '개선 진행중'; }).sort(function (a, b) { return (deadlineOf(a) || '9') < (deadlineOf(b) || '9') ? -1 : 1; }),
        findings: fs,
        inspections: (db.inspections || []).filter(inScope).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })
      };
    }
    return out;
  }

  /* ---------- 점수 분석 ---------- */
  function series(db, vendorId) {
    return SCORED.map(function (k) {
      return { kind: k, points: scoredHistory(db, vendorId, k).filter(function (x) { return x.s.pct != null; }).map(function (x) { return { date: x.audit.date, pct: x.s.pct, raw: x.s.raw, max: x.s.max, round: x.audit.round }; }) };
    }).filter(function (s) { return s.points.length; });
  }
  // 개선 효과: 종류마다 첫 Audit → 최근 Audit 백분율 변화, 개선조치 완료율
  function improvement(db, vendorId, today) {
    var kinds = SCORED.map(function (k) {
      var p = series(db, vendorId).filter(function (s) { return s.kind === k; })[0];
      if (!p || !p.points.length) return null;
      var a = p.points[0], b = p.points[p.points.length - 1];
      return { kind: k, n: p.points.length, first: a.pct, last: b.pct, change: p.points.length > 1 ? b.pct - a.pct : null, firstDate: a.date, lastDate: b.date };
    }).filter(Boolean);
    var c = findingCounts((db.findings || []).filter(function (f) { return f.vendorId === vendorId; }), today);
    return { kinds: kinds, closeRate: c.total ? c.closed / c.total * 100 : null, counts: c };
  }
  // 취약 공정: 최근 Audit 의 공정(구분)별 백분율 평균이 낮은 순 + 지적 건수
  function weakProcesses(db, vendorIds) {
    var m = {}, list = [];
    function get(kind, name) { var k = kind + '|' + name; if (!m[k]) { m[k] = { kind: kind, name: name, pcts: [], findings: 0, open: 0 }; list.push(m[k]); } return m[k]; }
    vendorIds.forEach(function (vid) {
      SCORED.forEach(function (k) {
        var h = scoredHistory(db, vid, k); if (!h.length) return;
        h[h.length - 1].s.groups.forEach(function (g) { if (g.pct != null) get(k, g.name).pcts.push(g.pct); });
      });
    });
    (db.findings || []).forEach(function (f) {
      if (vendorIds.indexOf(f.vendorId) < 0 || blank(f.finding) || !f.process || !f.kind) return;
      var g = get(f.kind, f.process); g.findings++;
      var s = findingStatus(f); if (s === '계획 미수립' || s === '개선 진행중') g.open++;
    });
    return list.map(function (g) { g.avgPct = avg(g.pcts); g.n = g.pcts.length; return g; })
      .sort(function (a, b) { return (a.avgPct == null ? 101 : a.avgPct) - (b.avgPct == null ? 101 : b.avgPct) || b.findings - a.findings; });
  }

  /* ---------- 양식 엑셀 읽기 ---------- */
  function norm(s) { return String(s == null ? '' : s).replace(/[\s ·.:()（）\[\]]/g, '').toLowerCase(); }
  var FIELDS = {
    A: { no: ['순', 'no', '번호'], item: ['항목', '항목ctq', 'ctq'], process: ['공정'], content: ['점검내용'], level: ['배점', 'level', '점수level'], weight: ['가중치'] },
    C: { process: ['공정', '공정구분'], no: ['no', '번호', '순'], content: ['점검내용및기준', '점검내용'], score: ['점수'], weight: ['가중치'] },
    D: { no: ['no', '번호', '순'], group: ['구분'], item: ['점검항목'], check: ['check사항', '체크사항', '확인사항'], points: ['배점'], score: ['평가점수'], dist: ['점수배분'] },
    Bb: { no: ['no', '번호', '순'], group: ['audit항목', '평가항목', '항목'], content: ['주요점검내용', '점검내용'], good: ['양호'], bad: ['개선요'], none: ['미실시'] },
    Bd: { no: ['순', 'no', '번호'], process: ['공정'], item: ['점검항목'], point: ['점검point', '점검포인트'], apply: ['해당사항여부', '해당여부'] }
  };
  var REQUIRED = { A: ['content', 'level', 'weight'], C: ['content', 'score', 'weight'], D: ['item', 'points'], Bb: ['content', 'good', 'bad', 'none'], Bd: ['item', 'point'] };
  var FIELD_LABEL = { no: '번호', item: '항목(CTQ 표시)', process: '공정', content: '점검 내용', level: '배점(Level)', weight: '가중치', score: '점수', group: '구분', check: 'Check 사항', points: '배점', dist: '점수배분', good: '양호', bad: '개선요', none: '미실시', point: '점검 Point', apply: '해당사항여부' };

  // 머리글 한 줄에서 필드별 열 찾기: 같은 낱말 → 그 낱말로 시작 → 포함 순으로, 이미 쓴 열은 건너뛴다
  function matchHeader(row, spec) {
    var cells = (row || []).map(norm), map = {}, used = {};
    ['exact', 'start', 'incl'].forEach(function (how) {
      Object.keys(spec).forEach(function (f) {
        if (map[f] != null) return;
        for (var j = 0; j < cells.length; j++) {
          if (used[j] || !cells[j]) continue;
          var hit = spec[f].some(function (k) { return how === 'exact' ? cells[j] === k : how === 'start' ? cells[j].indexOf(k) === 0 : (k.length > 1 && cells[j].indexOf(k) >= 0); });
          if (hit) { map[f] = j; used[j] = 1; return; }
        }
      });
    });
    return map;
  }
  function findHeader(aoa, specKey, maxScan) {
    var spec = FIELDS[specKey], req = REQUIRED[specKey];
    for (var i = 0; i < Math.min(aoa.length, maxScan || 40); i++) {
      var map = matchHeader(aoa[i], spec);
      if (req.every(function (f) { return map[f] != null; })) return { row: i, map: map };
    }
    return null;
  }
  function cell(r, j) { return j == null || !r ? '' : r[j] == null ? '' : String(r[j]).trim(); }
  function isTotalRow(r) { return (r || []).slice(0, 4).some(function (c) { return /^(total|합계|총계|계|총점)$/i.test(norm(c)); }); }
  function parseOptions(text, points) {
    var nums = String(text || '').match(/\d+/g);
    var opts = nums ? nums.map(Number).filter(function (n) { return n <= points; }) : [];
    if (opts.length < 2) { opts = []; for (var p = points; p >= 0; p--) opts.push(p); }
    opts = opts.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return b - a; });
    if (opts.indexOf(0) < 0) opts.push(0);
    return opts;
  }
  // 표 한 장 읽기. opts.headerRow · opts.map 을 주면 자동 찾기 대신 그대로 쓴다(사용자가 열을 고른 경우).
  function parseTable(specKey, aoa, opts) {
    opts = opts || {};
    var warnings = [], hdr;
    if (opts.map && opts.headerRow != null) hdr = { row: opts.headerRow, map: opts.map };
    else hdr = findHeader(aoa, specKey);
    if (!hdr) return { ok: false, error: '머리글 줄을 찾지 못했습니다 — 필요한 열: ' + REQUIRED[specKey].map(function (f) { return FIELD_LABEL[f]; }).join(' · '), items: [], warnings: warnings };
    var M = hdr.map, items = [], lastGroup = '', empty = 0, seq = 0;
    var contentKey = specKey === 'D' || specKey === 'Bd' ? 'item' : 'content';
    var groupKey = specKey === 'D' || specKey === 'Bb' ? 'group' : 'process';
    for (var i = hdr.row + 1; i < aoa.length; i++) {
      var r = aoa[i] || [];
      if (isTotalRow(r)) break;
      var g = cell(r, M[groupKey]);
      if (g) lastGroup = g;                         // 공정·구분 이름은 묶음 첫 행에만 — 아래로 물려받는다
      var text = cell(r, M[contentKey]);
      if (specKey === 'D' && !text) text = cell(r, M.check);
      if (!text) { if (++empty >= 3 && items.length) break; continue; }
      empty = 0; seq++;
      var noTxt = cell(r, M.no), no = noTxt && isFinite(num(noTxt)) ? String(num(noTxt)) : noTxt || String(seq);
      var it = { no: no };
      it[groupKey === 'group' ? 'group' : 'process'] = lastGroup || '(공정 없음)';
      if (specKey === 'A') {
        var itemTxt = cell(r, M.item), w = num(cell(r, M.weight));
        it.ctq = /ctq/i.test(itemTxt) || w === 2;
        if (w !== 1 && w !== 2) { w = it.ctq ? 2 : 1; warnings.push(no + '번 가중치가 1·2 가 아니어서 CTQ 표시로 정했습니다(' + w + ')'); }
        it.weight = w; it.content = text;
      } else if (specKey === 'C') {
        var wc = num(cell(r, M.weight));
        if (wc !== 1 && wc !== 2) { warnings.push(no + '번 가중치가 비어 있거나 1·2 가 아니어서 1 로 두었습니다'); wc = 1; }
        it.weight = wc; it.content = text;
      } else if (specKey === 'D') {
        var p = num(cell(r, M.points));
        if (!(p >= 1 && p <= 3 && p === Math.round(p))) { warnings.push(no + '번 배점이 1~3 이 아니어서 뺐습니다(' + (cell(r, M.points) || '빈 칸') + ')'); continue; }
        it.points = p; it.item = text; it.check = M.check != null && cell(r, M.check) !== text ? cell(r, M.check) : '';
        it.options = parseOptions(cell(r, M.dist), p);
      } else if (specKey === 'Bb') {
        it.content = text;
      } else if (specKey === 'Bd') {
        it.item = text; it.point = cell(r, M.point);
      }
      items.push(it);
    }
    var seen = {};
    items.forEach(function (it) { if (seen[it.no]) { warnings.push(it.no + '번이 두 번 나옵니다 — 뒤의 것은 ' + it.no + '-' + (seen[it.no] + 1) + ' 로 바꿨습니다'); it.no = it.no + '-' + (++seen[it.no]); } else seen[it.no] = 1; });
    if (!items.length) return { ok: false, error: '머리글 아래에 항목이 없습니다', items: [], warnings: warnings, headerRow: hdr.row, map: M, header: (aoa[hdr.row] || []).map(String) };
    return { ok: true, items: items, warnings: warnings, headerRow: hdr.row, map: M, header: (aoa[hdr.row] || []).map(function (c) { return c == null ? '' : String(c); }) };
  }
  // 통합문서 하나 읽기. sheets = { 시트이름: aoa }, names = 시트 순서.
  function parseFormBook(kind, sheets, names, opts) {
    names = names || Object.keys(sheets); opts = opts || {};
    if (kind !== 'B') {
      var tryNames = opts.sheet ? [opts.sheet] : names;
      var firstErr = null;
      for (var i = 0; i < tryNames.length; i++) {
        var r = parseTable(kind, sheets[tryNames[i]] || [], opts);
        if (r.ok) { r.sheet = tryNames[i]; r.kind = kind; return r; }
        firstErr = firstErr || r;
      }
      var e = firstErr || { ok: false, error: '시트가 없습니다', items: [], warnings: [] };
      e.kind = kind; e.sheet = tryNames[0];
      return e;
    }
    // PSO: 기본 체크 시트(이름에 Pre 가 있으면 Pre-PSO, 아니면 PSO)와 상세 시트를 따로 찾는다
    var out = { ok: false, kind: 'B', preBasic: [], preDetail: [], psoBasic: [], warnings: [], sheets: {} };
    names.forEach(function (n) {
      var aoa = sheets[n] || [];
      if (/issue|이슈/i.test(n)) return;
      var b = findHeader(aoa, 'Bb'), d = findHeader(aoa, 'Bd');
      if (b) {
        var rb = parseTable('Bb', aoa);
        var key = /pre/i.test(n) ? 'preBasic' : 'psoBasic';
        if (rb.ok && !out[key].length) { out[key] = rb.items; out.sheets[key] = n; out.warnings = out.warnings.concat(rb.warnings); }
      } else if (d) {
        var rd = parseTable('Bd', aoa);
        if (rd.ok && !out.preDetail.length) { out.preDetail = rd.items; out.sheets.preDetail = n; out.warnings = out.warnings.concat(rd.warnings); }
      }
    });
    out.ok = out.preBasic.length > 0 || out.psoBasic.length > 0;
    if (!out.ok) out.error = '「양호 · 개선요 · 미실시」 머리글이 있는 시트를 찾지 못했습니다';
    if (out.ok && !out.preBasic.length) out.warnings.push('Pre-PSO 기본 시트가 없습니다(시트 이름에 Pre 가 있어야 합니다)');
    if (out.ok && !out.psoBasic.length) out.warnings.push('PSO 기본 시트가 없습니다');
    return out;
  }
  function makeForm(kind, parsed, meta) {
    meta = meta || {};
    var f = { id: meta.id || uid('form-' + kind), kind: kind, name: meta.name || KINDS[kind].name, source: meta.source || '', created: meta.created || '', sample: !!meta.sample };
    if (kind === 'B') { f.preBasic = parsed.preBasic; f.preDetail = parsed.preDetail; f.psoBasic = parsed.psoBasic; }
    else f.items = parsed.items;
    return f;
  }
  function formSize(f) {
    if (!f) return 0;
    return f.kind === 'B' ? (f.preBasic || []).length + (f.preDetail || []).length + (f.psoBasic || []).length : f.items.length;
  }
  function formMax(f) {
    if (f.kind === 'A') return f.items.reduce(function (s, it) { return s + it.weight * 3; }, 0);
    if (f.kind === 'C') return f.items.reduce(function (s, it) { return s + it.weight * 2; }, 0);
    if (f.kind === 'D') return f.items.reduce(function (s, it) { return s + it.points; }, 0);
    return null;
  }

  /* ---------- 지어낸 예제 양식 (실제 회사 양식이 아니다) ---------- */
  function A_(no, ctq, process, content) { return { no: String(no), ctq: ctq, process: process, weight: ctq ? 2 : 1, content: content }; }
  function C_(no, process, weight, content) { return { no: String(no), process: process, weight: weight, content: content }; }
  function D_(no, group, points, item, check, options) { return { no: String(no), group: group, points: points, item: item, check: check, options: options || parseOptions('', points) }; }
  var SAMPLE_FORMS = {
    A: {
      items: [
        A_(1, true, '단품', '절단면 거칠기와 드로스를 한도 견본과 대조해 관리하는가'),
        A_(2, false, '단품', '절단 치수를 첫 품과 중간 품마다 측정해 기록하는가'),
        A_(3, false, '단품', '벤딩 각도를 게이지로 확인하고 기록을 남기는가'),
        A_(4, true, '제관', '가접 위치와 간격을 지그 기준대로 맞추는가'),
        A_(5, false, '제관', '용접 전에 조립 치수(직각도·평행도)를 확인하는가'),
        A_(6, true, '용접', '용접 전류·전압·속도가 작업표준 범위 안에 있는가'),
        A_(7, true, '용접', '비드 외관(언더컷·오버랩·기공)을 전수 확인하는가'),
        A_(8, false, '용접', '용접 재료의 건조·보관 기준을 지키는가'),
        A_(9, false, '후처리', '스패터와 슬래그 제거 상태를 확인하는가'),
        A_(10, false, '후처리', '변형 교정 뒤 치수를 다시 확인하는가'),
        A_(11, true, '가공', '가공 기준면과 주요 치수를 측정해 기록하는가'),
        A_(12, false, '가공', '공구 마모와 교체 주기를 관리하는가'),
        A_(13, true, '검사·관리', '출하 전 최종 검사를 검사 기준대로 하는가'),
        A_(14, false, '검사·관리', '부적합품을 구분 보관하고 처리 이력을 남기는가')
      ]
    },
    C: {
      items: [
        C_(1, '원자재', 2, '입고 자재의 성적서와 실물 표시를 대조하는가'),
        C_(2, '원자재', 1, '자재 보관 구역과 식별 표시가 구분되어 있는가'),
        C_(3, '절단/벤딩', 1, '절단·벤딩 작업표준이 현장에 게시되어 있는가'),
        C_(4, '절단/벤딩', 2, '첫 품 치수 확인 기록이 있는가'),
        C_(5, '가접/제관', 1, '지그 점검 기록이 주기대로 남아 있는가'),
        C_(6, '가접/제관', 2, '가접 뒤 치수 확인을 하는가'),
        C_(7, '용접', 2, '용접사 자격과 작업 배치가 맞는가'),
        C_(8, '용접', 1, '용접 조건 기록이 남아 있는가'),
        C_(9, '전처리', 2, '블라스팅 뒤 표면 청정도를 확인하는가'),
        C_(10, '전처리', 1, '연마재 상태를 주기적으로 점검하는가'),
        C_(11, '도장', 2, '도막 두께를 측정해 기록하는가'),
        C_(12, '도장', 1, '도료 보관 온도와 유효기간을 관리하는가')
      ]
    },
    D: {
      items: [
        D_(1, '전처리 · 도료', 3, '표면 처리 상태', '녹·유분·먼지 제거 상태를 확인하는가'),
        D_(2, '전처리 · 도료', 2, '도료 관리', '도료 유효기간과 보관 온도를 관리하는가'),
        D_(3, '하도 도장', 3, '하도 도막', '하도 도막 두께를 측정하는가'),
        D_(4, '하도 도장', 2, '퍼티·연마', '퍼티 뒤 연마면 상태를 확인하는가'),
        D_(5, '상도 도장', 3, '상도 도막', '상도 도막 두께를 측정하는가'),
        D_(6, '상도 도장', 2, '도장 환경', '부스 온도와 습도를 기록하는가'),
        D_(7, '상도 도장', 2, '건조 조건', '건조 온도와 시간을 지키는가'),
        D_(8, '도장 품질', 3, '외관 검사', '흐름·핀홀·이물 외관 검사를 하는가'),
        D_(9, '도장 품질', 1, '부착력 시험', '부착력 시험을 주기대로 하는가'),
        D_(10, '품질 관리', 1, '부적합 관리', '도장 불량 재작업 이력을 남기는가')
      ]
    },
    B: {
      preBasic: [
        { no: '1', group: '문제점 반영', content: '이전 단계 문제점이 대책에 반영되었는가' },
        { no: '2', group: '라인 준비', content: '공정 배치와 설비 준비 계획이 있는가' },
        { no: '3', group: '공정관리', content: '공정 위험 분석과 관리 계획이 최신인가' },
        { no: '4', group: '공정관리', content: '중요 특성의 관리 방법이 정해져 있는가' },
        { no: '5', group: '수입검사', content: '수입검사 기준과 기록이 있는가' },
        { no: '6', group: '작업자 교육', content: '작업자 교육 기록이 있는가' }
      ],
      preDetail: [
        { no: '1', process: '제작준비', item: '작업 지도서', point: '공정마다 작업 지도서가 준비되었는가' },
        { no: '2', process: '자재', item: '자재 식별', point: '자재 식별 표시 방법이 정해졌는가' },
        { no: '3', process: '제관/용접', item: '용접 지그', point: '지그 검증 계획이 있는가' },
        { no: '4', process: '제관/용접', item: '용접 조건', point: '용접 조건표가 준비되었는가' },
        { no: '5', process: '가공', item: '가공 치구', point: '치구 보유와 검증 여부' },
        { no: '6', process: '도장', item: '도장 사양', point: '도장 사양과 두께 기준을 받았는가' },
        { no: '7', process: '검사', item: '검사 치공구', point: '검사 게이지 보유와 교정 여부' },
        { no: '8', process: '포장', item: '포장 사양', point: '포장 방법과 표시가 정해졌는가' }
      ],
      psoBasic: [
        { no: '1', group: '문제점 반영', content: 'Pre-PSO 지적사항이 모두 조치되었는가' },
        { no: '2', group: '공정관리', content: '양산 조건에서 관리 계획대로 작업하는가' },
        { no: '3', group: '수입검사', content: '수입검사를 기준대로 하고 있는가' },
        { no: '4', group: '검사장비', content: '측정기 교정 상태가 유효한가' },
        { no: '5', group: '포장·출하', content: '포장 사양대로 출하하는가' }
      ]
    }
  };
  function sampleForms() {
    return ORDER.map(function (k) {
      var src = JSON.parse(JSON.stringify(SAMPLE_FORMS[k]));
      return makeForm(k, src, { id: 'sample-' + k, name: KINDS[k].name + ' (예제 양식)', source: '리포 예제(지어낸 항목)', created: '2026-11-03', sample: true });
    });
  }
  // 예제 양식을 회사 엑셀과 같은 모양의 표로 — samples/*.xlsx 와 양식 읽기 테스트가 같이 쓴다.
  // 공정·구분 이름은 묶음 첫 행에만 적는다(실제 양식처럼). 머리글 위에 제목·기본 정보 줄이 있다.
  function sampleFormBook(kind) {
    var F = SAMPLE_FORMS[kind], sheets = {}, names = [];
    function first(list, key) { var last = null; return list.map(function (it) { var g = it[key]; var show = g !== last; last = g; return show ? g : ''; }); }
    if (kind === 'A') {
      var pa = first(F.items, 'process');
      sheets['CP Audit (예제)'] = [
        ['대형 제관 공정 Audit Check Sheet (예제 양식 — 실제 회사 양식 아님)'],
        ['업체', '', '실시일', '', 'AUDIT 결과', ''],
        ['종합의견'],
        [],
        ['순', '항목', '공정', '점검내용', '배점', '가중치', '환산점수', '항목별 의견']
      ].concat(F.items.map(function (it, i) { return [Number(it.no), it.ctq ? 'CTQ' : '', pa[i], it.content, '', it.weight, '', '']; }))
        .concat([['TOTAL', '', '', '', '', F.items.reduce(function (s, it) { return s + it.weight; }, 0) * 3, '', '']]);
      names.push('CP Audit (예제)');
    } else if (kind === 'C') {
      var pc = first(F.items, 'process');
      sheets['결과 종합'] = [['Process Audit 결과 종합 (예제)'], ['협력사명', ''], ['총 점', '']];
      sheets['세부 점검 결과'] = [
        ['Process Audit 세부 점검 결과 (예제 양식 — 실제 회사 양식 아님)'],
        [],
        ['공정', 'NO', '점검 내용 및 기준', '점수', '가중치', '환산', '점검 결과']
      ].concat(F.items.map(function (it, i) { return [pc[i], Number(it.no), it.content, '', it.weight, '', '']; }));
      names.push('결과 종합', '세부 점검 결과');
    } else if (kind === 'D') {
      var pd = first(F.items, 'group');
      sheets['도장 Audit (예제)'] = [
        ['도장품질 Audit Check list (예제 양식 — 실제 회사 양식 아님)'],
        ['Vendor', '', 'Audit 실시일', '', '점수', ''],
        [],
        ['No', '구분', '점검 항목', 'Check 사항', '점검 결과', '배점', '평가점수', '점수배분', '재지적 건']
      ].concat(F.items.map(function (it, i) { return [Number(it.no), pd[i], it.item, it.check, '', it.points, '', it.options.join(' / '), '']; }));
      names.push('도장 Audit (예제)');
    } else {
      var basic = function (list) {
        var pg = first(list, 'group');
        return [['PSO Check Sheet (예제 양식 — 실제 회사 양식 아님)'], ['업체 Code', '', '업체명', '', '실시일', ''], [],
          ['No', 'Audit 항목', '주요 점검 내용', '양호', '개선요', '미실시', '평가 의견']].concat(list.map(function (it, i) { return [Number(it.no), pg[i], it.content, '', '', '', '']; }));
      };
      var pp = first(F.preDetail, 'process');
      sheets['개정이력'] = [['개정 이력 (예제)'], ['Rev', '일자', '내용']];
      sheets['Pre-PSO(기본)'] = basic(F.preBasic);
      sheets['Pre-PSO(상세)'] = [['Pre-PSO 상세 점검 (예제)'], ['협력사명', '', '품번', ''], [],
        ['순', '공정', '점검항목', '점검 Point', '외주 제작여부', '보유여부', '점검결과', '해당사항여부']].concat(F.preDetail.map(function (it, i) { return [Number(it.no), pp[i], it.item, it.point, '', '', '', '']; }));
      sheets['Issue List'] = [['No', '기종', '단계', '품번', '품명', 'Issue', 'Action', 'Result', 'Owner', 'Status', 'Target', 'Actual']];
      sheets['PSO(기본)'] = basic(F.psoBasic);
      names.push('개정이력', 'Pre-PSO(기본)', 'Pre-PSO(상세)', 'Issue List', 'PSO(기본)');
    }
    return { names: names, sheets: sheets };
  }

  /* ---------- 공정점검 · 메일 ---------- */
  function fitSize(w, h, max) {
    max = max || 1280;
    if (w <= max && h <= max) return { w: w, h: h, scaled: false };
    var k = max / Math.max(w, h);
    return { w: Math.round(w * k), h: Math.round(h * k), scaled: true };
  }
  function inspectionSummary(insp) {
    var rows = insp.rows || [];
    var c = { rows: rows.length, problems: 0, photos: 0, done: 0 };
    rows.forEach(function (r) {
      if (!blank(r.problem)) c.problems++;
      c.photos += (r.problemPhotos || []).length + (r.fixPhotos || []).length;
      if (r.state === '완료') c.done++;
    });
    return c;
  }
  // 메일 초안 — 적혀 있는 것만 쓴다. 비어 있으면 「(입력 없음)」 으로 두고 missing 에 모은다.
  function buildMail(type, insp, ctx) {
    ctx = ctx || {};
    var missing = [], L = [];
    var vendor = ctx.vendorName || '', who = ctx.inspectorName || '';
    function need(v, label) { if (blank(v)) { missing.push(label); return '(입력 없음)'; } return String(v).trim(); }
    var rows = (insp.rows || []).filter(function (r) { return !blank(r.process) || !blank(r.item) || !blank(r.check) || !blank(r.problem) || !blank(r.request); });
    var probs = rows.filter(function (r) { return !blank(r.problem); });
    var reqs = rows.filter(function (r) { return !blank(r.request); });
    function photoNote(r) {
      var a = (r.problemPhotos || []).length, b = (r.fixPhotos || []).length;
      if (!a && !b) return '';
      var caps = (r.problemPhotos || []).concat(r.fixPhotos || []).map(function (p) { return p.caption; }).filter(function (x) { return !blank(x); });
      return '    사진: 문제점 ' + a + '장 · 개선 ' + b + '장' + (caps.length ? ' (' + caps.join(', ') + ')' : '');
    }
    function label(r, i) { return (i + 1) + '. ' + [r.process, r.item].filter(function (x) { return !blank(x); }).join(' / '); }
    var date = need(insp.date, '점검 일자'), target = need(insp.target, '대상 공정');
    if (blank(vendor)) missing.push('업체명');
    var subject;
    if (type === 'internal') {
      subject = '[공정점검 보고] ' + (vendor || '(업체 미입력)') + ' ' + (blank(insp.target) ? '' : insp.target + ' ') + '공정점검 결과 (' + (insp.date || '일자 미입력') + ')';
      L.push('1. 점검 개요');
      L.push('  - 점검 일자: ' + date);
      L.push('  - 업체: ' + (vendor || '(입력 없음)'));
      L.push('  - 점검 목적: ' + need(insp.purpose, '점검 목적'));
      L.push('  - 대상 공정: ' + target);
      L.push('  - 점검 담당: ' + (who || need('', '점검 담당자')) + (blank(insp.attendees) ? '' : ' / 참석: ' + insp.attendees));
      L.push('');
      L.push('2. 주요 점검 결과 (' + rows.length + '개 항목, 문제점 ' + probs.length + '건)');
      if (!rows.length) { L.push('  (입력 없음)'); missing.push('점검 항목'); }
      rows.forEach(function (r, i) { L.push('  ' + label(r, i) + (blank(r.check) ? '' : ' — ' + r.check)); });
      L.push('');
      L.push('3. 주요 문제점 및 지적사항');
      if (!probs.length) L.push('  문제점 없음');
      probs.forEach(function (r, i) { L.push('  ' + label(r, i) + ': ' + r.problem); var p = photoNote(r); if (p) L.push(p); });
      L.push('');
      L.push('4. 개선 요청사항');
      if (!reqs.length) L.push('  요청사항 없음');
      reqs.forEach(function (r, i) { L.push('  ' + label(r, i) + ': ' + r.request + ' (완료 예정 ' + (blank(r.due) ? '미정' : r.due) + ' · ' + (r.state || '요청') + (blank(r.owner) ? '' : ' · 담당 ' + r.owner) + ')'); });
      L.push('');
      L.push('5. 업체 조치계획');
      L.push('  ' + need(insp.vendorPlan, '업체 조치계획'));
      L.push('');
      L.push('6. 종합 의견 및 향후 계획');
      L.push('  ' + need(insp.overall, '종합 의견'));
    } else {
      var dues = reqs.map(function (r) { return r.due; }).filter(function (x) { return !blank(x); }).sort();
      subject = '[개선 요청] ' + (insp.date || '') + ' 공정점검 결과 안내 및 개선 요청' + (vendor ? ' — ' + vendor : '');
      L.push((vendor || '(업체 미입력)') + ' 품질 담당자님께');
      L.push('');
      L.push('안녕하십니까.');
      L.push(date + '에 실시한 ' + target + ' 공정점검 결과를 아래와 같이 안내드립니다.');
      L.push('');
      L.push('1. 점검 결과 안내');
      L.push('  - 점검 일자: ' + date);
      L.push('  - 점검 목적: ' + need(insp.purpose, '점검 목적'));
      L.push('  - 점검 항목 ' + rows.length + '개 중 지적사항 ' + probs.length + '건');
      L.push('');
      L.push('2. 주요 지적사항');
      if (!probs.length) L.push('  지적사항 없음');
      probs.forEach(function (r, i) { L.push('  ' + label(r, i) + ': ' + r.problem); var p = photoNote(r); if (p) L.push(p); });
      L.push('');
      L.push('3. 개선 요청 내용');
      if (!reqs.length) L.push('  요청사항 없음');
      reqs.forEach(function (r, i) { L.push('  ' + label(r, i) + ': ' + r.request); });
      L.push('');
      L.push('4. 개선 완료 요청일');
      if (!reqs.length) L.push('  해당 없음');
      else if (!dues.length) { L.push('  (입력 없음)'); missing.push('완료 예정일'); }
      else reqs.forEach(function (r, i) { L.push('  ' + label(r, i) + ': ' + (blank(r.due) ? '(입력 없음)' : r.due)); });
      L.push('');
      L.push('5. 개선 결과 회신 요청');
      L.push('  개선을 마치시면 조치 내용과 개선 전·후 사진을 함께 회신해 주시기 바랍니다.');
      if (dues.length) L.push('  첫 회신은 ' + dues[0] + '까지 부탁드립니다.');
      L.push('');
      L.push('협조해 주셔서 감사합니다.');
      if (who) L.push(who + ' 드림');
    }
    var uniq = missing.filter(function (v, i, a) { return a.indexOf(v) === i; });
    return { type: type, subject: subject, body: L.join('\n'), missing: uniq };
  }
  function mailto(to, subject, body) {
    return 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  /* ---------- 내보내기 · 백업 ---------- */
  function nameOf(list, id) { var x = (list || []).filter(function (v) { return v.id === id; })[0]; return x ? x.name : ''; }
  function reportSheets(db, vendorIds, today) {
    var inV = function (x) { return !vendorIds || vendorIds.indexOf(x.vendorId) >= 0; };
    var vname = function (id) { return nameOf(db.vendors, id); };
    var res = [['업체', '종류', '차수', '실시일', '평가자', '양식', '원점수', '만점(유효)', '백분율', '판정', '미입력 항목', '이전 대비', '요약']];
    var items = [['업체', '종류', '차수', '실시일', '번호', '공정·구분', '점검 내용', '입력', '가중치·배점', '환산']];
    (db.audits || []).filter(inV).slice().sort(function (a, b) { return a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : byDate(a, b); }).forEach(function (a) {
      var f = formOf(db, a), s = score(a.kind, f, a), cp = compare(db, previousOf(db, a), a);
      res.push([vname(a.vendorId), KINDS[a.kind].name, a.round || '', a.date, a.auditor || '', f ? f.name : '', s.raw == null ? '' : Math.round(s.raw * 100) / 100, s.max == null ? '' : s.max,
        s.kind === 'B' ? '' : s.pct == null ? 'N/A' : round1(s.pct), judgeOf(s), s.missing, cp && cp.delta != null ? round1(cp.delta) : '', summaryText(s)]);
      if (a.kind === 'B') {
        var Lb = bLists(f, a.stage);
        Lb.basic.forEach(function (it) { items.push([vname(a.vendorId), KINDS.B.name + ' ' + (a.stage || 'Pre-PSO'), a.round || '', a.date, it.no, it.group, it.content, (a.values || {})[it.no] || '', '', '']); });
        Lb.detail.forEach(function (it) { var d = (a.detail || {})[it.no] || {}; items.push([vname(a.vendorId), KINDS.B.name + ' 상세', a.round || '', a.date, it.no, it.process, it.item + ' — ' + it.point, (d.res || '') + (d.apply === '제외' ? ' (제외)' : ''), '', '']); });
      } else {
        f.items.forEach(function (it, i) {
          var r = s.rows[i];
          items.push([vname(a.vendorId), KINDS[a.kind].name, a.round || '', a.date, it.no, it.process || it.group, it.content || it.item, r.level != null ? r.level : r.score != null ? r.score : '', a.kind === 'D' ? it.points : it.weight, r.conv == null ? '' : r.conv]);
        });
      }
    });
    var fnd = [['No', '업체', '종류', '평가일', '유형', '공정명', '평가자', '지적사항', '원인분석', '재발방지 개선대책', '개선부서/담당', '완료 요청일', '계획일정', '완료일정', '확인일', '확인자', '결과', '기한 초과', '재발유무', '관련사진', '개선사진', '조치 이력', '비고']];
    (db.findings || []).filter(inV).forEach(function (f, i) {
      fnd.push([i + 1, vname(f.vendorId), f.kind ? KINDS[f.kind].name : '공정점검', f.date || '', f.type || '', f.process || '', f.evaluator || '', f.finding || '', [f.why1, f.why2, f.why3].filter(function (x) { return !blank(x); }).join(' → '),
        f.measure || '', f.dept || '', f.dueDate || '', f.planDate || '', f.doneDate || '', f.verifiedDate || '', f.verifier || '', findingStatus(f), isOverdue(f, today) ? '기한 초과' : '', f.recur || '',
        (f.beforePhotos || []).length, (f.afterPhotos || []).length, (f.log || []).map(function (l) { return l.date + ' ' + l.text; }).join(' / '), f.note || '']);
    });
    var ins = [['점검 일자', '업체', '점검 목적', '대상 공정', '점검 담당', '참석자', 'No', '점검 공정', '점검 항목', '확인 내용', '문제점', '문제점 사진', '개선 요청사항', '개선 사진', '담당자', '완료 예정일', '진행상태', '업체 조치계획', '종합 의견']];
    (db.inspections || []).filter(inV).forEach(function (x) {
      (x.rows || [{}]).forEach(function (r, i) {
        ins.push([x.date || '', vname(x.vendorId), x.purpose || '', x.target || '', nameOf(db.managers, x.inspectorId), x.attendees || '', i + 1, r.process || '', r.item || '', r.check || '', r.problem || '', (r.problemPhotos || []).length, r.request || '', (r.fixPhotos || []).length, r.owner || '', r.due || '', r.state || '', i ? '' : x.vendorPlan || '', i ? '' : x.overall || '']);
      });
    });
    var mails = [['작성일', '업체', '유형', '제목', '본문']];
    (db.mails || []).filter(inV).forEach(function (m) { mails.push([m.created || '', vname(m.vendorId), m.type === 'internal' ? '내부 보고' : '업체 발송', m.subject, m.body]); });
    return { names: ['Audit결과', '항목별점수', '지적사항', '공정점검', '메일이력'], sheets: { 'Audit결과': res, '항목별점수': items, '지적사항': fnd, '공정점검': ins, '메일이력': mails } };
  }
  var SCHEMA = 'qa-2611-14';
  function emptyDb() {
    var forms = sampleForms(), act = {};
    forms.forEach(function (f) { act[f.kind] = f.id; });
    return { schema: SCHEMA, version: 1, managers: [], vendors: [], forms: forms, activeForms: act, audits: [], findings: [], inspections: [], mails: [] };
  }
  function backup(db, photos, at) { return JSON.stringify({ schema: SCHEMA, version: 1, exported: at || '', db: db, photos: photos || [] }); }
  function restore(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return { ok: false, error: 'JSON 이 아닙니다' }; }
    if (!o || o.schema !== SCHEMA || !o.db) return { ok: false, error: '이 도구의 백업 파일이 아닙니다' };
    var d = o.db, need = ['managers', 'vendors', 'forms', 'audits', 'findings', 'inspections', 'mails'];
    for (var i = 0; i < need.length; i++) if (!Array.isArray(d[need[i]])) return { ok: false, error: need[i] + ' 목록이 없습니다' };
    d.activeForms = d.activeForms || {};
    return { ok: true, db: d, photos: Array.isArray(o.photos) ? o.photos : [] };
  }

  /* ---------- 지어낸 예제 데이터 ---------- */
  // 사진 대신 쓰는 회색 그림(SVG). 실제 현장 사진이 아니다.
  function placeholderPhoto(text, tone) {
    var bg = tone === 'after' ? '#dfeee6' : '#f1e3df', fg = tone === 'after' ? '#0a6045' : '#8a2a17';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="' + bg + '"/>' +
      '<rect x="40" y="40" width="520" height="320" fill="none" stroke="' + fg + '" stroke-width="4" stroke-dasharray="14 10"/>' +
      '<text x="300" y="190" font-family="sans-serif" font-size="30" font-weight="700" fill="' + fg + '" text-anchor="middle">예제 사진</text>' +
      '<text x="300" y="236" font-family="sans-serif" font-size="22" fill="' + fg + '" text-anchor="middle">' + String(text).replace(/[<&>]/g, '') + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function sample(today) {
    today = today || ymd(new Date());
    var r = rng(261114), db = emptyDb(), photos = [];
    db.managers = [{ id: 'm1', name: '김품질(예제)', email: '' }, { id: 'm2', name: '이점검(예제)', email: '' }];
    db.vendors = [
      { id: 'v1', code: 'V-1001', name: 'A정밀(예제)', managerId: 'm1', part: '대형 제관', email: '' },
      { id: 'v2', code: 'V-1002', name: 'B제관(예제)', managerId: 'm1', part: '소형 제관', email: '' },
      { id: 'v3', code: 'V-1003', name: 'C도장(예제)', managerId: 'm2', part: '도장', email: '' },
      { id: 'v4', code: 'V-1004', name: 'D산업(예제)', managerId: 'm2', part: '대형 제관 · 도장', email: '' }
    ];
    var forms = {}; db.forms.forEach(function (f) { forms[f.kind] = f; });
    // 업체·종류마다 [며칠 전, 품질 수준(0~1)] — 점수가 오르거나 내리도록
    var plan = {
      v1: { A: [[330, 0.45], [200, 0.62], [45, 0.8]], C: [[260, 0.55], [90, 0.75]], B: [[20, 0.7]] },
      v2: { A: [[280, 0.78], [60, 0.6]], C: [[300, 0.5], [170, 0.62], [30, 0.85]] },
      v3: { D: [[310, 0.5], [150, 0.7], [25, 0.9]], C: [[120, 0.7]] },
      v4: { D: [[240, 0.8], [50, 0.55]], A: [[270, 0.7], [80, 0.82]], B: [[15, 0.5]] }
    };
    var auditors = { m1: '김품질(예제)', m2: '이점검(예제)' };
    var n = 0;
    Object.keys(plan).forEach(function (vid) {
      var v = db.vendors.filter(function (x) { return x.id === vid; })[0];
      Object.keys(plan[vid]).forEach(function (k) {
        plan[vid][k].forEach(function (pq, idx) {
          var q = pq[1], date = addDays(today, -pq[0]), f = forms[k], a = { id: 'a' + (++n), kind: k, vendorId: vid, date: date, round: idx + 1, auditor: auditors[v.managerId], formId: f.id, values: {}, notes: {}, opinion: '' };
          if (k === 'A') f.items.forEach(function (it) { var x = r(); a.values[it.no] = x < q ? 3 : x < q + (1 - q) * 0.55 ? 2 : x < q + (1 - q) * 0.85 ? 1 : 0; });
          if (k === 'C') f.items.forEach(function (it, i) { var x = r(); a.values[it.no] = (i === 9 && idx === 0) ? 'N/A' : x < q ? 2 : x < q + (1 - q) * 0.6 ? 1 : 0; });
          if (k === 'D') f.items.forEach(function (it, i) { var x = r(); a.values[it.no] = (i === 9 && idx > 0) ? 'N/A' : x < q ? it.options[0] : x < q + (1 - q) * 0.6 ? it.options[1] : it.options[it.options.length - 1]; });
          if (k === 'B') {
            a.stage = vid === 'v1' ? 'Pre-PSO' : 'PSO'; a.detail = {}; a.issues = [];
            a.product = { model: '예제-100', name: '예제 프레임', partNo: 'EX-' + (1000 + n), ppap: '3' };
            bLists(f, a.stage).basic.forEach(function (it) { var x = r(); a.values[it.no] = x < q ? '양호' : x < q + (1 - q) * 0.7 ? '개선요' : '미실시'; });
            bLists(f, a.stage).detail.forEach(function (it, i) { var x = r(); a.detail[it.no] = i === 7 ? { res: '', apply: '제외' } : { res: x < q + 0.15 ? 'OK' : 'NG', apply: '해당' }; });
            a.issues.push({ no: 1, stage: 'Pilot', partNo: a.product.partNo, partName: '예제 프레임', place: '용접 공정', date: addDays(date, 0), requester: auditors[v.managerId], request: '용접 지그 고정 핀 마모 — 교체 요청', action: '', result: '', owner: '', status: 2, target: addDays(today, -3), actual: '' });
          }
          a.opinion = '예제 Audit 입니다(지어낸 점수).';
          db.audits.push(a);
          // 낮은 항목은 지적사항으로 — 오래된 Audit 일수록 조치가 끝나 있다
          var low = [];
          if (k === 'A') f.items.forEach(function (it) { if (a.values[it.no] <= 1) low.push({ it: it, why: 'Level ' + a.values[it.no] }); });
          if (k === 'C') f.items.forEach(function (it) { if (a.values[it.no] === 0) low.push({ it: it, why: '0점' }); });
          if (k === 'D') f.items.forEach(function (it) { var s = a.values[it.no]; if (s !== 'N/A' && s < it.points - 1) low.push({ it: it, why: s + '/' + it.points + '점' }); });
          low.slice(0, 4).forEach(function (L, j) {
            var age = pq[0], fd = { id: 'f' + (db.findings.length + 1), auditId: a.id, vendorId: vid, kind: k, itemNo: L.it.no, date: date, type: k === 'D' ? '도장' : (L.it.ctq ? 'CTQ' : '공정'), process: L.it.process || L.it.group, evaluator: a.auditor,
              finding: '「' + (L.it.content || L.it.check) + '」 미흡(' + L.why + ')', why1: '', why2: '', why3: '', measure: '', dept: '', dueDate: addDays(date, 30), planDate: '', doneDate: '', verifiedDate: '', verifier: '', recur: '', note: '', beforePhotos: [], afterPhotos: [], log: [{ date: date, text: '지적 등록' }] };
            if (age > 100) {
              fd.why1 = '작업 기준 미숙지'; fd.measure = '작업 기준 재교육 · 점검표 추가'; fd.dept = '생산팀';
              fd.planDate = addDays(date, 20); fd.doneDate = addDays(date, 18 + j); fd.log.push({ date: fd.doneDate, text: '개선 완료 회신' });
              if (j % 2 === 0) { fd.verifiedDate = addDays(date, 25 + j); fd.verifier = a.auditor; fd.log.push({ date: fd.verifiedDate, text: '현장 확인 완료' }); }
            } else if (j === 0) {
              fd.why1 = '설비 점검 주기 누락'; fd.measure = '점검 주기 표 게시'; fd.dept = '품질팀'; fd.planDate = addDays(today, -5); fd.log.push({ date: addDays(date, 3), text: '조치 계획 접수' });   // 기한 초과
            } else if (j === 1) {
              fd.planDate = addDays(today, 14); fd.measure = '지그 보강'; fd.dept = '생산기술'; fd.log.push({ date: addDays(date, 4), text: '조치 계획 접수' });
            }
            db.findings.push(fd);
          });
        });
      });
    });
    db.findings.forEach(function (f) { f.recur = recurOf(f, db.findings); });
    // 공정점검 2건(사진은 예제 그림)
    function ph(text, tone) { var id = 'p' + (photos.length + 1); photos.push({ id: id, data: placeholderPhoto(text, tone) }); return { id: id, caption: text }; }
    db.inspections = [
      { id: 'i1', vendorId: 'v1', date: addDays(today, -6), purpose: '용접 불량 재발 확인', target: '용접 · 후처리', inspectorId: 'm1', attendees: '업체 품질 담당, 생산 반장', vendorPlan: '용접 조건표 재게시와 작업자 재교육을 다음 주까지 진행 예정', overall: '용접 조건 관리는 나아졌으나 후처리 검사 기록이 빠져 있습니다. 2주 뒤 재점검합니다.',
        rows: [
          { process: '용접', item: '용접 조건', check: '조건표 게시 · 실제 전류 측정', problem: '조건표와 실제 전류가 다름', problemPhotos: [ph('전류 표시값', 'before')], request: '조건표 범위로 맞추고 측정 기록을 남겨 주세요', fixPhotos: [], owner: '업체 생산', due: addDays(today, 7), state: '조치 중' },
          { process: '후처리', item: '스패터 제거', check: '제거 상태 육안 확인', problem: '모서리 스패터 잔존', problemPhotos: [ph('모서리 스패터', 'before'), ph('하부 잔존', 'before')], request: '제거 후 확인 기록 추가', fixPhotos: [ph('제거 후', 'after')], owner: '업체 품질', due: addDays(today, 3), state: '완료' },
          { process: '검사', item: '최종 검사 기록', check: '기록지 확인', problem: '', problemPhotos: [], request: '', fixPhotos: [], owner: '', due: '', state: '완료' }
        ] },
      { id: 'i2', vendorId: 'v3', date: addDays(today, -12), purpose: '정기 공정점검', target: '도장', inspectorId: 'm2', attendees: '업체 도장 반장', vendorPlan: '', overall: '도막 두께 관리는 양호합니다.',
        rows: [
          { process: '상도', item: '도막 두께', check: '5개 지점 측정', problem: '', problemPhotos: [], request: '', fixPhotos: [], owner: '', due: '', state: '완료' },
          { process: '건조', item: '건조 조건', check: '온도 기록 확인', problem: '야간 온도 기록 누락', problemPhotos: [ph('온도 기록지', 'before')], request: '야간 근무조도 기록해 주세요', fixPhotos: [], owner: '업체 도장', due: addDays(today, 10), state: '요청' }
        ] }
    ];
    return { db: db, photos: photos, today: today };
  }

  var api = {
    KINDS: KINDS, ORDER: ORDER, SCORED: SCORED, LEVEL_GUIDE: LEVEL_GUIDE, FINDING_TYPES: FINDING_TYPES, INSPECT_STATES: INSPECT_STATES, ISSUE_STATUS: ISSUE_STATUS,
    STATUS: STATUS, B_MARKS: B_MARKS, B_RESULTS: B_RESULTS, FIELDS: FIELDS, REQUIRED: REQUIRED, FIELD_LABEL: FIELD_LABEL, SAMPLE_FORMS: SAMPLE_FORMS, SCHEMA: SCHEMA,
    num: num, isNA: isNA, blank: blank, round1: round1, ymd: ymd, addDays: addDays, daysBetween: daysBetween, uid: uid,
    judgeA: judgeA, judgeD: judgeD, gradeC: gradeC, judgeTone: judgeTone, judgeOf: judgeOf,
    scoreA: scoreA, scoreC: scoreC, scoreD: scoreD, scoreB: scoreB, score: score, bLists: bLists, summaryText: summaryText, rawText: rawText,
    formOf: formOf, activeForm: activeForm, history: history, scoredHistory: scoredHistory, nextRound: nextRound, previousOf: previousOf, compare: compare,
    findingStatus: findingStatus, deadlineOf: deadlineOf, isOverdue: isOverdue, findingKey: findingKey, recurOf: recurOf, repeatAnalysis: repeatAnalysis, findingCounts: findingCounts,
    scopeOf: scopeOf, vendorRow: vendorRow, dashboard: dashboard, series: series, improvement: improvement, weakProcesses: weakProcesses,
    matchHeader: matchHeader, findHeader: findHeader, parseTable: parseTable, parseFormBook: parseFormBook, parseOptions: parseOptions, makeForm: makeForm, formSize: formSize, formMax: formMax,
    sampleForms: sampleForms, sampleFormBook: sampleFormBook,
    fitSize: fitSize, inspectionSummary: inspectionSummary, buildMail: buildMail, mailto: mailto,
    reportSheets: reportSheets, emptyDb: emptyDb, backup: backup, restore: restore, placeholderPhoto: placeholderPhoto, sample: sample
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QA = api;
})(this);
