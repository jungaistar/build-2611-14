/* 화면 — 점수·판정·상태·집계·메일 초안은 audit.js(QA)가 한다. 여기서는 읽고, 그리고, 저장할 뿐이다.
 * 저장: 이 PC 브라우저의 IndexedDB(자료 1건 + 사진 저장소). 서버로 아무것도 보내지 않는다(선택한 AI 다듬기만 예외, 보내기 전에 묻는다). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var K = QA.KINDS;
  var S = {
    db: QA.emptyDb(), photos: {}, sel: { managerId: '', vendorId: '' }, route: 'dashboard',
    edit: null, findEdit: null, inspEdit: null, mail: null, formDraft: null, today: QA.ymd(new Date())
  };

  /* ---------- 저장(IndexedDB) ---------- */
  var idb = null;
  function openDb() {
    return new Promise(function (res) {
      if (!window.indexedDB) return res(null);
      var rq;
      try { rq = indexedDB.open('qa-2611-14', 1); } catch (e) { return res(null); }
      rq.onupgradeneeded = function () { var d = rq.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos'); };
      rq.onsuccess = function () { idb = rq.result; res(idb); };
      rq.onerror = function () { res(null); };
    });
  }
  function tx(store, mode, fn) {
    return new Promise(function (res, rej) {
      if (!idb) return res(null);
      var t = idb.transaction(store, mode), st = t.objectStore(store), out = fn(st);
      t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
      t.onerror = function () { rej(t.error); };
    });
  }
  function loadAll() {
    return tx('kv', 'readonly', function (st) { return st.get('db'); }).then(function (d) {
      if (d && d.schema === QA.SCHEMA) S.db = d;
      return new Promise(function (res) {
        if (!idb) return res();
        var t = idb.transaction('photos', 'readonly'), c = t.objectStore('photos').openCursor();
        c.onsuccess = function () { var cur = c.result; if (cur) { S.photos[cur.key] = cur.value; cur.continue(); } };
        t.oncomplete = function () { res(); };
      });
    });
  }
  // 바로 쓴다 — 미루면(디바운스) 저장 직후 창을 닫거나 새로 고칠 때 마지막 변경이 사라진다(연기 테스트에서 실제로 잃었다).
  function save() {
    $('saved').textContent = '저장 중…';
    var snap;
    try { snap = JSON.parse(JSON.stringify(S.db)); } catch (e) { $('saved').textContent = '저장 실패: ' + e.message; return; }
    tx('kv', 'readwrite', function (st) { return st.put(snap, 'db'); }).then(function () {
      $('saved').textContent = idb ? '저장됨 · 이 브라우저(IndexedDB)' : '저장 안 됨 — 이 브라우저는 IndexedDB 를 쓸 수 없습니다(백업 파일로 보관하세요)';
    }).catch(function (e) { $('saved').textContent = '저장 실패: ' + e.message; });
  }
  function putPhoto(id, data) { S.photos[id] = data; return tx('photos', 'readwrite', function (st) { return st.put(data, id); }); }
  function clearPhotos() { S.photos = {}; return tx('photos', 'readwrite', function (st) { return st.clear(); }); }
  function photoList() { return Object.keys(S.photos).map(function (id) { return { id: id, data: S.photos[id] }; }); }

  /* ---------- 공통 조각 ---------- */
  function toast(t) { var d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2200); }
  function stat(label, value, cls, small) { return '<div class="stat ' + (cls || '') + '"><b>' + value + '</b>' + esc(label) + (small ? '<br><small>' + small + '</small>' : '') + '</div>'; }
  function pct(x) { return x == null ? '—' : QA.round1(x).toFixed(1); }
  function tag(j) { return j ? '<span class="tag ' + QA.judgeTone(j) + '">' + esc(j) + '</span>' : ''; }
  function delta(d) { if (d == null) return '<span class="sub">—</span>'; var r = QA.round1(d); return '<span class="' + (r > 0 ? 'up' : r < 0 ? 'down' : '') + '">' + (r > 0 ? '+' : '') + r.toFixed(1) + '</span>'; }
  function stTag(s) { var c = { '계획 미수립': 'bad', '개선 진행중': 'mid', '개선 완료': 'blue', '확인 완료': 'ok' }[s]; return s ? '<span class="tag ' + (c || '') + '">' + esc(s) + '</span>' : ''; }
  function vendor(id) { return S.db.vendors.filter(function (v) { return v.id === id; })[0] || null; }
  function manager(id) { return S.db.managers.filter(function (m) { return m.id === id; })[0] || null; }
  function vname(id) { var v = vendor(id); return v ? v.name : '(삭제된 업체)'; }
  function mname(id) { var m = manager(id); return m ? m.name : ''; }
  function scope() { return QA.scopeOf(S.db, S.sel); }
  function opts(list, sel, none) { return (none != null ? '<option value="">' + esc(none) + '</option>' : '') + list.map(function (o) { var v = typeof o === 'object' ? o.v : o, t = typeof o === 'object' ? o.t : o; return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join(''); }
  function needVendor(what) {
    return '<div class="card empty"><h2>업체를 먼저 고르세요</h2><p class="sub">' + esc(what) + '은(는) 위의 <b>업체 선택</b>을 따릅니다. 메뉴마다 업체를 다시 고르지 않습니다.</p></div>';
  }
  function sampleNote() { return S.db.sample ? '<p class="sub">예제 데이터는 실제 사내 데이터가 아닙니다 — 지어낸 담당자 2명 · 업체 4곳 · Audit 이력입니다.</p>' : ''; }
  function download(name, blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  // 클립보드에 글자 넣기. 클립보드 API 가 막혀 있으면(오래된 브라우저 · 사내 정책) 숨긴 글상자를 골라 복사한다.
  function copyText(text, done) {
    function legacy() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select(); var okc = false; try { okc = document.execCommand('copy'); } catch (e) { okc = false; } ta.remove();
      done(okc);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, legacy);
    else legacy();
  }
  var OFFLINE = !!window.QA_OFFLINE;

  /* ---------- 그래프(SVG 직접) ---------- */
  function lineChart(series, o) {
    o = o || {};
    var W = 640, H = 270, L = 44, R = 16, T = 16, B = 40;
    var pts = []; series.forEach(function (s) { s.points.forEach(function (p) { pts.push(p); }); });
    if (!pts.length) return '<p class="sub">그릴 점수가 없습니다.</p>';
    var dates = pts.map(function (p) { return p.date; }).sort(), d0 = dates[0], d1 = dates[dates.length - 1], span = Math.max(1, QA.daysBetween(d0, d1));
    var X = function (d) { return L + (dates.length === 1 || d0 === d1 ? (W - L - R) / 2 : QA.daysBetween(d0, d) / span * (W - L - R)); };
    var Y = function (v) { return T + (100 - Math.max(0, Math.min(100, v))) / 100 * (H - T - B); };
    var g = '';
    [0, 25, 50, 75, 100].forEach(function (v) { g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v + '</text>'; });
    (o.refs || []).forEach(function (r) { g += '<line class="ref ' + (r.cls || '') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(r.y) + '" y2="' + Y(r.y) + '"/><text class="ax" x="' + (W - R - 2) + '" y="' + (Y(r.y) - 4) + '" text-anchor="end">' + esc(r.label) + '</text>'; });
    var ticks = [d0, d1]; if (span > 60) ticks.splice(1, 0, QA.addDays(d0, Math.round(span / 2)));
    ticks.forEach(function (d) { g += '<text class="ax" x="' + X(d) + '" y="' + (H - B + 18) + '" text-anchor="middle">' + d.slice(2).replace(/-/g, '.') + '</text>'; });
    series.forEach(function (s) {
      g += '<polyline class="k' + s.kind + '" points="' + s.points.map(function (p) { return X(p.date) + ',' + Y(p.pct); }).join(' ') + '"/>';
      s.points.forEach(function (p) { g += '<circle class="k' + s.kind + '" cx="' + X(p.date) + '" cy="' + Y(p.pct) + '" r="4.5"><title>' + esc(K[s.kind].name + ' ' + p.date + ' ' + pct(p.pct) + '점') + '</title></circle>'; });
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || '점수 변화') + '">' + g + '</svg>' + legend(series.map(function (s) { return s.kind; }));
  }
  function legend(kinds) { return '<div class="legend">' + kinds.map(function (k) { return '<span><i class="k' + k + '"></i>' + esc(K[k].name) + '</span>'; }).join('') + '</div>'; }
  // 업체마다 종류별 막대(가로)
  function barChart(rows, kinds) {
    var W = 640, L = 132, R = 46, bh = 13, gap = 14, T = 10;
    var H = T + rows.length * (kinds.length * bh + gap) + 24;
    var X = function (v) { return L + v / 100 * (W - L - R); };
    var g = '';
    [0, 50, 75, 90, 100].forEach(function (v) { g += '<line class="' + (v === 75 || v === 90 ? 'ref' + (v === 90 ? ' g' : '') : 'grid') + '" x1="' + X(v) + '" x2="' + X(v) + '" y1="' + T + '" y2="' + (H - 20) + '"/><text class="ax" x="' + X(v) + '" y="' + (H - 6) + '" text-anchor="middle">' + v + '</text>'; });
    var y = T;
    rows.forEach(function (r) {
      var h = kinds.length * bh;
      g += '<text class="axt" x="' + (L - 8) + '" y="' + (y + h / 2 + 4) + '" text-anchor="end">' + esc(r.label.length > 10 ? r.label.slice(0, 10) + '…' : r.label) + '</text>';
      kinds.forEach(function (k, i) {
        var v = r.values[k];
        if (v != null) g += '<rect class="k' + k + '" x="' + L + '" y="' + (y + i * bh + 1) + '" width="' + Math.max(1, X(v) - L) + '" height="' + (bh - 2) + '" rx="2"><title>' + esc(r.label + ' · ' + K[k].name + ' ' + pct(v)) + '</title></rect><text class="ax" x="' + (X(v) + 4) + '" y="' + (y + i * bh + bh - 3) + '">' + pct(v) + '</text>';
      });
      y += h + gap;
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="업체별 최근 Audit 점수">' + g + '</svg>' + legend(kinds) +
      '<p class="sub" style="margin-top:4px">세로 점선: 75 · 90 (대형 제관 판정 경계). 막대 길이는 백분율입니다 — 종류마다 배점이 달라 원점수는 표에서 보세요.</p>';
  }

  /* ---------- 선택 조건 ---------- */
  function renderSel() {
    var ms = S.db.managers, vs = S.db.vendors.filter(function (v) { return !S.sel.managerId || v.managerId === S.sel.managerId; });
    $('sel-manager').innerHTML = opts(ms.map(function (m) { return { v: m.id, t: m.name }; }), S.sel.managerId, '전체 담당자');
    $('sel-vendor').innerHTML = opts(vs.map(function (v) { return { v: v.id, t: v.name }; }), S.sel.vendorId, S.sel.managerId ? '담당 업체 전체' : '전체 업체');
    var sc = scope();
    $('sel-mode').textContent = sc.mode === 'vendor' ? '업체 상세 · ' + sc.vendor.name : sc.mode === 'manager' ? '담당자 현황 · ' + mname(sc.managerId) + ' (' + sc.vendorIds.length + '곳)' : '전체 업체 통합 현황 (' + sc.vendorIds.length + '곳)';
  }
  function setSel(m, v) {
    S.sel.managerId = m || ''; S.sel.vendorId = v || '';
    if (S.sel.vendorId && !S.sel.managerId) { var vv = vendor(S.sel.vendorId); if (vv) S.sel.managerId = vv.managerId || ''; }
    if (S.sel.vendorId && scope().mode !== 'vendor') S.sel.vendorId = '';
    try { localStorage.setItem('qa14.sel', JSON.stringify(S.sel)); } catch (e) { /* 저장 못 해도 화면은 돈다 */ }
    S.edit = null; S.inspEdit = null; S.findEdit = null; S.mail = null; S.inspPaste = false; S.inspPasteMsg = null;
    renderSel(); render();
  }

  /* ---------- 라우팅 ---------- */
  function route() {
    var h = (location.hash || '').replace(/^#\/?/, '') || 'dashboard';
    S.route = h;
    document.querySelectorAll('#side a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-r') === h); });
    render();
  }
  function go(r) { if (location.hash === '#/' + r) route(); else location.hash = '#/' + r; }
  function render() {
    var r = S.route, v = $('view');
    if (r === 'dashboard') v.innerHTML = viewDashboard();
    else if (r === 'vendors') v.innerHTML = viewVendors();
    else if (/^audit\/[ABCD]$/.test(r)) v.innerHTML = viewAudit(r.slice(6));
    else if (r === 'findings') v.innerHTML = viewFindings();
    else if (r === 'analysis') v.innerHTML = viewAnalysis();
    else if (r === 'inspect') v.innerHTML = viewInspect();
    else if (r === 'mail') v.innerHTML = viewMail();
    else if (r === 'data') v.innerHTML = viewData();
    else v.innerHTML = '<div class="card">없는 메뉴입니다.</div>';
    if (/^audit\//.test(r) && S.edit) renderAuditSummary();
  }

  /* ---------- Dashboard ---------- */
  function viewDashboard() {
    if (!S.db.vendors.length) {
      return '<div class="card empty"><h2>협력업체 품질 현황을 한 곳에서 봅니다</h2>' +
        '<p>아직 등록된 업체가 없습니다. 예제로 먼저 둘러보거나, <b>협력업체 관리</b>에서 담당자와 업체를 등록하세요.</p>' +
        '<div class="btnrow"><button class="btn primary" id="btn-sample" data-act="sample">예제로 해보기</button><a class="btn" href="#/vendors">업체 등록하기</a><a class="btn" href="#/data">회사 양식 올리기</a></div>' +
        '<p class="sub" style="margin-top:12px">예제 데이터는 실제 사내 데이터가 아닙니다. 예제 양식의 항목도 지어낸 것입니다 — 회사 양식은 「데이터 관리」에서 엑셀로 올리면 항목·배점을 그대로 읽습니다.</p></div>';
    }
    var d = QA.dashboard(S.db, S.sel, S.today), k = d.kpi, f = k.findings;
    var title = d.mode === 'vendor' ? esc(d.scope.vendor.name) + ' 상세 현황' : d.mode === 'manager' ? esc(mname(d.scope.managerId)) + ' 담당 업체 현황' : '전체 업체 통합 현황';
    var h = '<div class="card"><div class="head"><h2>' + title + '</h2><span class="sub">기준일 ' + S.today + '</span></div>' + sampleNote() +
      '<div class="stats" id="kpi">' +
      (d.mode === 'vendor' ? stat('공정점검', k.inspections + '건') : stat('관리 업체 수', k.vendors + '곳')) +
      stat('Audit 실시 건수', k.audits + '건', '', QA.ORDER.map(function (x) { return K[x].short + ' ' + k.byKind[x]; }).join(' · ')) +
      stat('평균 점수', pct(k.avgPct), '', '종류별 최근 Audit 백분율 평균') +
      stat('개선 진행', f.open + '건', f.open ? '' : 'good', '계획 미수립 ' + f['계획 미수립'] + ' · 진행중 ' + f['개선 진행중']) +
      stat('개선 완료', f.closed + '건', 'good', '확인 완료 ' + f['확인 완료']) +
      stat('기한 초과', f.overdue + '건', f.overdue ? 'bad' : 'good') +
      '</div></div>';
    if (d.mode !== 'vendor') {
      var bars = d.rows.map(function (r) { var o = { label: vname(r.vendorId), values: {} }; QA.SCORED.forEach(function (x) { o.values[x] = r.last[x] ? r.last[x].pct : null; }); return o; });
      h += '<div class="card"><h3 style="margin-top:0">업체별 최근 Audit 점수 비교</h3><div class="chart" id="dash-chart">' + barChart(bars, ['C', 'A', 'D']) + '</div></div>';
      h += '<div class="card"><h3 style="margin-top:0">업체별 상세 현황 <small>행을 누르면 그 업체 상세로 바뀝니다</small></h3><div class="tablewrap"><table id="vendor-table"><thead><tr><th>업체</th><th>담당자</th>' +
        QA.ORDER.map(function (x) { return '<th>' + esc(K[x].name) + '</th>'; }).join('') + '<th class="num">평균</th><th class="num">개선 진행</th><th class="num">완료</th><th class="num">기한 초과</th><th class="num">공정점검</th></tr></thead><tbody>' +
        d.rows.map(function (r) {
          var v = vendor(r.vendorId);
          return '<tr class="click" data-act="pick-vendor" data-id="' + r.vendorId + '"><td><b>' + esc(v.name) + '</b></td><td>' + esc(mname(v.managerId)) + '</td>' +
            QA.ORDER.map(function (x) { var L = r.last[x]; if (!L) return '<td class="sub">—</td>'; return '<td>' + (x === 'B' ? esc(L.s.stage) + ' ' : pct(L.pct) + ' ') + tag(L.judge) + (x !== 'B' ? ' ' + delta(L.delta) : '') + '<br><small class="sub">' + L.date + '</small></td>'; }).join('') +
            '<td class="num">' + pct(r.avgPct) + '</td><td class="num">' + r.findings.open + '</td><td class="num">' + r.findings.closed + '</td><td class="num">' + (r.findings.overdue ? '<span class="tag bad">' + r.findings.overdue + '</span>' : '0') + '</td><td class="num">' + r.inspections + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="sub" style="margin-top:8px">백분율 옆 숫자는 이전 Audit 대비 증감입니다. PSO 는 점수 없는 체크형이라 판정 대신 개선요·미실시 개수를 보여 줍니다.</p></div>';
    } else {
      var dt = d.detail;
      h += '<div class="card"><h3 style="margin-top:0">Audit 점수 변화</h3><div class="chart" id="dash-chart">' + lineChart(dt.series, { refs: [{ y: 90, label: '90', cls: 'g' }, { y: 75, label: '75' }] }) + '</div></div>';
      h += '<div class="card"><h3 style="margin-top:0">Audit 종류별 실시 이력</h3><div class="tablewrap"><table id="kind-table"><thead><tr><th>종류</th><th>실시일</th><th class="num">차수</th><th>원점수 / 만점</th><th class="num">백분율</th><th>판정</th><th class="num">이전 대비</th><th></th></tr></thead><tbody>' +
        dt.byKind.map(function (b) {
          if (!b.list.length) return '<tr><td>' + esc(K[b.kind].name) + '</td><td colspan="7" class="sub">실시 이력 없음</td></tr>';
          return b.list.slice().reverse().map(function (x, i, arr) {
            var prev = arr[i + 1], dl = prev && prev.s.pct != null && x.s.pct != null ? x.s.pct - prev.s.pct : null;
            return '<tr><td>' + (i ? '<span class="sub">〃</span>' : esc(K[b.kind].name)) + '</td><td>' + x.audit.date + '</td><td class="num">' + (x.audit.round || '') + '</td><td>' + (b.kind === 'B' ? esc(QA.summaryText(x.s)) : esc(QA.rawText(x.s))) + '</td><td class="num">' + (b.kind === 'B' ? '—' : pct(x.s.pct)) + '</td><td>' + tag(QA.judgeOf(x.s)) + '</td><td class="num">' + delta(dl) + '</td>' +
              '<td><button class="btn xs" data-act="open-audit" data-id="' + x.audit.id + '">열기</button></td></tr>';
          }).join('');
        }).join('') + '</tbody></table></div></div>';
      h += '<div class="card"><h3 style="margin-top:0">미완료 개선사항 <small>' + dt.open.length + '건 · 기한 빠른 순</small></h3>' + findingTable(dt.open, 'dash-open') + '</div>';
      h += '<div class="card"><h3 style="margin-top:0">공정점검 이력</h3>' + (dt.inspections.length ? '<div class="tablewrap"><table><thead><tr><th>점검 일자</th><th>대상 공정</th><th>점검 목적</th><th class="num">항목</th><th class="num">문제점</th><th class="num">사진</th><th></th></tr></thead><tbody>' +
        dt.inspections.map(function (x) { var c = QA.inspectionSummary(x); return '<tr><td>' + esc(x.date) + '</td><td>' + esc(x.target) + '</td><td class="wrap">' + esc(x.purpose) + '</td><td class="num">' + c.rows + '</td><td class="num">' + c.problems + '</td><td class="num">' + c.photos + '</td><td><button class="btn xs" data-act="open-insp" data-id="' + x.id + '">열기</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="sub">공정점검 이력이 없습니다.</p>') + '</div>';
    }
    return h;
  }
  function findingTable(list, id) {
    if (!list.length) return '<p class="sub">해당하는 지적사항이 없습니다.</p>';
    return '<div class="tablewrap"><table id="' + id + '"><thead><tr><th class="num">No</th><th>업체</th><th>종류</th><th>평가일</th><th>유형</th><th>공정명</th><th class="wrap">지적사항</th><th class="wrap">개선대책</th><th>개선부서/담당</th><th>완료 요청일</th><th>계획일정</th><th>완료일정</th><th>결과</th><th>기한</th><th>재발유무</th></tr></thead><tbody>' +
      list.map(function (f, i) {
        var st = QA.findingStatus(f), ov = QA.isOverdue(f, S.today);
        return '<tr class="click' + (ov ? ' over' : '') + (S.findEdit && S.findEdit.id === f.id ? ' sel' : '') + '" data-act="open-finding" data-id="' + f.id + '"><td class="num">' + (i + 1) + '</td><td>' + esc(vname(f.vendorId)) + '</td><td>' + esc(f.kind ? K[f.kind].short : '공정점검') + '</td><td>' + esc(f.date) + '</td><td>' + esc(f.type) + '</td><td>' + esc(f.process) + '</td><td class="wrap">' + esc(f.finding) + '</td><td class="wrap">' + esc(f.measure) + '</td><td>' + esc(f.dept) + '</td><td>' + esc(f.dueDate) + '</td><td>' + esc(f.planDate) + '</td><td>' + esc(f.doneDate) + '</td><td>' + stTag(st) + '</td><td>' + (ov ? '<span class="tag bad">기한 초과</span>' : '') + '</td><td>' + (f.recur === '재발' ? '<span class="tag mid">재발</span>' : esc(f.recur)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- 협력업체 관리 ---------- */
  function viewVendors() {
    var ms = S.db.managers;
    var h = '<div class="card"><h2>담당자</h2><div class="tablewrap"><table id="mgr-table"><thead><tr><th>이름</th><th>이메일(내부 보고 받는 곳 · 선택)</th><th class="num">관리 업체</th><th></th></tr></thead><tbody>' +
      ms.map(function (m) { var n = S.db.vendors.filter(function (v) { return v.managerId === m.id; }).length; return '<tr><td><input type="text" data-act="mgr-edit" data-id="' + m.id + '" data-k="name" value="' + esc(m.name) + '"></td><td><input type="text" data-act="mgr-edit" data-id="' + m.id + '" data-k="email" value="' + esc(m.email) + '"></td><td class="num">' + n + '</td><td>' + (n ? '' : '<button class="btn xs danger" data-act="mgr-del" data-id="' + m.id + '">삭제</button>') + '</td></tr>'; }).join('') +
      '</tbody></table></div><div class="form"><label>새 담당자 이름 <input id="new-mgr"></label><button class="btn" data-act="mgr-add">담당자 추가</button></div></div>';
    h += '<div class="card"><h2>협력업체</h2><p class="sub">담당자를 정해 두면 대시보드에서 담당자별 현황이 묶입니다.</p><div class="tablewrap"><table id="ven-table"><thead><tr><th>업체 코드</th><th>업체명</th><th>담당자</th><th>부품 유형</th><th>이메일(업체 발송 · 선택)</th><th class="num">Audit</th><th></th></tr></thead><tbody>' +
      S.db.vendors.map(function (v) {
        var n = S.db.audits.filter(function (a) { return a.vendorId === v.id; }).length;
        var cell = function (k) { return '<td><input type="text" data-act="ven-edit" data-id="' + v.id + '" data-k="' + k + '" value="' + esc(v[k]) + '"></td>'; };
        return '<tr>' + cell('code') + cell('name') + '<td><select data-act="ven-edit" data-id="' + v.id + '" data-k="managerId">' + opts(ms.map(function (m) { return { v: m.id, t: m.name }; }), v.managerId, '(없음)') + '</select></td>' + cell('part') + cell('email') + '<td class="num">' + n + '</td><td>' + (n ? '' : '<button class="btn xs danger" data-act="ven-del" data-id="' + v.id + '">삭제</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="form"><label>업체 코드 <input id="new-ven-code"></label><label>업체명 <input id="new-ven-name"></label><label>담당자 <select id="new-ven-mgr">' + opts(ms.map(function (m) { return { v: m.id, t: m.name }; }), S.sel.managerId, '(없음)') + '</select></label><button class="btn primary" data-act="ven-add">업체 추가</button></div>' +
      '<p class="sub">Audit 이력이 있는 업체·담당자는 지울 수 없습니다(이력이 고아가 되지 않게).</p></div>';
    return h;
  }

  /* ---------- Audit 관리 ---------- */
  function viewAudit(kind) {
    var sc = scope(), form = QA.activeForm(S.db, kind);
    var h = '<div class="card"><div class="head"><h2>' + esc(K[kind].name) + '</h2><span class="sub">양식: ' + esc(form ? form.name : '없음') + (form ? ' · 항목 ' + QA.formSize(form) + '개' + (kind !== 'B' ? ' · 만점 ' + QA.formMax(form) : '') : '') + ' · <a href="#/data">양식 바꾸기</a></span></div>';
    if (sc.mode !== 'vendor') {
      var all = S.db.audits.filter(function (a) { return a.kind === kind && sc.vendorIds.indexOf(a.vendorId) >= 0; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      return h + '<p>위에서 <b>업체를 고르면</b> 그 업체의 이력과 새 Audit 입력이 열립니다. 아래는 지금 선택 조건의 ' + esc(K[kind].name) + ' 전체 이력입니다(행을 누르면 그 업체로 바뀝니다).</p>' +
        auditList(all, true) + '</div>';
    }
    var hist = QA.scoredHistory(S.db, sc.vendor.id, kind).slice().reverse();
    h += '<div class="btnrow tight"><button class="btn primary" id="btn-new-audit" data-act="new-audit" data-kind="' + kind + '">새 Audit 입력</button></div>';
    h += auditList(hist.map(function (x) { return x.audit; }), false) + '</div>';
    if (S.edit && S.edit.kind === kind) h += auditEditor(kind);
    return h;
  }
  function auditList(list, withVendor) {
    if (!list.length) return '<p class="sub">이력이 없습니다.</p>';
    return '<div class="tablewrap"><table id="audit-hist"><thead><tr>' + (withVendor ? '<th>업체</th>' : '') + '<th>실시일</th><th class="num">차수</th><th>평가자</th><th>원점수 / 만점</th><th class="num">백분율</th><th>판정</th><th class="num">이전 대비</th><th class="num">미입력</th><th></th></tr></thead><tbody>' +
      list.map(function (a) {
        var s = QA.score(a.kind, QA.formOf(S.db, a), a), cp = QA.compare(S.db, QA.previousOf(S.db, a), a);
        return '<tr class="' + (withVendor ? 'click' : '') + (S.edit && S.edit.audit.id === a.id ? ' sel' : '') + '"' + (withVendor ? ' data-act="pick-vendor" data-id="' + a.vendorId + '"' : '') + '>' + (withVendor ? '<td>' + esc(vname(a.vendorId)) + '</td>' : '') + '<td>' + a.date + '</td><td class="num">' + (a.round || '') + '</td><td>' + esc(a.auditor) + '</td><td>' + esc(a.kind === 'B' ? QA.summaryText(s) : QA.rawText(s)) + '</td><td class="num">' + (a.kind === 'B' ? '—' : pct(s.pct)) + '</td><td>' + tag(QA.judgeOf(s)) + '</td><td class="num">' + delta(cp ? cp.delta : null) + '</td><td class="num">' + (s.missing || '') + '</td>' +
          '<td>' + (withVendor ? '' : '<button class="btn xs" data-act="open-audit" data-id="' + a.id + '">열기</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function newAudit(kind) {
    var sc = scope(), form = QA.activeForm(S.db, kind);
    var a = { id: QA.uid('a'), kind: kind, vendorId: sc.vendor.id, date: S.today, round: QA.nextRound(S.db, sc.vendor.id, kind), auditor: mname(sc.vendor.managerId), formId: form.id, values: {}, notes: {}, opinion: '' };
    if (kind === 'B') { a.stage = 'Pre-PSO'; a.detail = {}; a.issues = []; a.product = { model: '', name: '', partNo: '', ppap: '' }; }
    S.edit = { kind: kind, audit: a, isNew: true };
  }
  function auditEditor(kind) {
    var a = S.edit.audit, f = QA.formOf(S.db, a);
    var h = '<div class="card" id="audit-editor"><div class="head"><h2>' + (S.edit.isNew ? '새 ' : '') + esc(K[kind].name) + ' — ' + esc(vname(a.vendorId)) + ' ' + (a.round || '') + '차</h2><span class="sub">양식 ' + esc(f.name) + '</span></div>';
    h += '<div class="form"><label>실시일 <input type="date" id="ed-date" data-act="ed-head" data-k="date" value="' + esc(a.date) + '"></label><label>차수 <input type="number" min="1" data-act="ed-head" data-k="round" value="' + esc(a.round) + '"></label><label>평가자(AUDITOR) <input data-act="ed-head" data-k="auditor" value="' + esc(a.auditor) + '"></label>';
    if (kind === 'B') {
      h += '<label>단계 <select id="ed-stage" data-act="ed-stage">' + opts(['Pre-PSO', 'PSO'], a.stage) + '</select></label>' +
        ['model', 'name', 'partNo', 'ppap'].map(function (k) { return '<label>' + { model: '기종', name: '품명', partNo: '품번', ppap: 'PPAP Level' }[k] + ' <input data-act="ed-prod" data-k="' + k + '" value="' + esc(a.product[k]) + '"></label>'; }).join('');
    }
    h += '</div>';
    if (kind === 'A') {
      h += '<details open><summary><b>Level 평가 Guide</b></summary><div class="tablewrap" style="max-width:640px"><table class="guide"><thead><tr><th>Level</th><th>발생빈도</th><th>상태</th></tr></thead><tbody>' +
        QA.LEVEL_GUIDE.map(function (g) { return '<tr><td><b>' + g.level + '</b></td><td>' + esc(g.freq) + '</td><td>' + esc(g.text) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<p class="note">발견한 문제는 <b>원인 항목 하나에만</b> 평가합니다 — 같은 문제를 여러 항목에서 깎으면 점수가 겹쳐 내려갑니다. CTQ 항목은 가중치 2 입니다.</p></details>';
    }
    if (kind === 'D') h += '<p class="note">배점 3 = 품질 영향이 가장 큰 항목, 2 = 영향은 있으나 자체 공정에서 일부 관리, 1 = 영향이 다소 낮음. 점검 항목을 모두 만족하면 최고점, 하나도 만족하지 못하면 0 입니다. N/A 항목은 분자·분모에서 모두 뺍니다.</p>';
    if (kind === 'C') h += '<p class="note">점수 2 · 1 · 0 · N/A. 공정마다 10점 환산(유효 합계가 0 이면 N/A)과 Grade(9 이상 Green · 7 이상 Yellow · 그 밖 Red), 총점은 100점 환산입니다.</p>';
    h += '<div class="edit-grid"><div>' + auditTable(kind, a, f) + '</div><div><div class="sumbox" id="ed-sum"></div></div></div>';
    h += '<h3>종합의견</h3><textarea class="big" data-act="ed-head" data-k="opinion">' + esc(a.opinion) + '</textarea>';
    h += '<div id="ed-cmp"></div>';
    h += '<div class="btnrow"><button class="btn primary" id="btn-save-audit" data-act="save-audit">Audit 저장</button><button class="btn" data-act="close-audit">닫기</button>' + (S.edit.isNew ? '' : '<button class="btn danger" data-act="del-audit">이 Audit 삭제</button>') + '</div></div>';
    return h;
  }
  function auditTable(kind, a, f) {
    var last = null;
    var grp = function (g) { var show = g !== last; last = g; return show ? '<b>' + esc(g) + '</b>' : '<span class="rep">' + esc(g) + '</span>'; };
    var note = function (no) { return '<td><input type="text" data-act="ed-note" data-no="' + esc(no) + '" value="' + esc((a.notes || {})[no]) + '"></td>'; };
    var fb = function (no) { return '<td><button class="btn xs" data-act="add-finding" data-no="' + esc(no) + '">지적 등록</button></td>'; };
    var v = function (no) { var x = (a.values || {})[no]; return x == null ? '' : String(x); };
    var sel = function (no, list) { return '<select class="ed-v" data-act="ed-val" data-no="' + esc(no) + '" aria-label="' + esc(no) + '번 입력">' + opts(list, v(no), '—') + '</select>'; };
    if (kind === 'A') return '<div class="tablewrap"><table id="ed-table"><thead><tr><th class="num">순</th><th>공정</th><th class="wrap">점검 내용</th><th>Level</th><th class="num">가중치</th><th class="num">환산</th><th>항목별 의견</th><th></th></tr></thead><tbody>' +
      f.items.map(function (it) { return '<tr><td class="num">' + esc(it.no) + '</td><td>' + grp(it.process) + '</td><td class="wrap">' + esc(it.content) + (it.ctq ? '<span class="ctq">CTQ</span>' : '') + '</td><td>' + sel(it.no, ['3', '2', '1', '0']) + '</td><td class="num">' + it.weight + '</td><td class="num" id="cv-' + esc(it.no) + '"></td>' + note(it.no) + fb(it.no) + '</tr>'; }).join('') + '</tbody></table></div>';
    if (kind === 'C') return '<div class="tablewrap"><table id="ed-table"><thead><tr><th>공정</th><th class="num">NO</th><th class="wrap">점검 내용 및 기준</th><th>점수</th><th class="num">가중치</th><th class="num">환산</th><th>점검 결과</th><th></th></tr></thead><tbody>' +
      f.items.map(function (it) { return '<tr><td>' + grp(it.process) + '</td><td class="num">' + esc(it.no) + '</td><td class="wrap">' + esc(it.content) + '</td><td>' + sel(it.no, ['2', '1', '0', 'N/A']) + '</td><td class="num">' + it.weight + '</td><td class="num" id="cv-' + esc(it.no) + '"></td>' + note(it.no) + fb(it.no) + '</tr>'; }).join('') + '</tbody></table></div>';
    if (kind === 'D') return '<div class="tablewrap"><table id="ed-table"><thead><tr><th class="num">No</th><th>구분</th><th>점검 항목</th><th class="wrap">Check 사항</th><th class="num">배점</th><th>평가점수</th><th>점검 결과</th><th></th></tr></thead><tbody>' +
      f.items.map(function (it) { return '<tr><td class="num">' + esc(it.no) + '</td><td>' + grp(it.group) + '</td><td>' + esc(it.item) + '</td><td class="wrap">' + esc(it.check) + '</td><td class="num">' + it.points + '</td><td>' + sel(it.no, it.options.map(String).concat(['N/A'])) + '</td>' + note(it.no) + fb(it.no) + '</tr>'; }).join('') + '</tbody></table></div>';
    // PSO
    var L = QA.bLists(f, a.stage), dv = a.detail || {};
    var h = '<h3 style="margin-top:4px">' + esc(a.stage) + ' 기본 점검</h3><div class="tablewrap"><table id="ed-table"><thead><tr><th class="num">No</th><th>Audit 항목</th><th class="wrap">주요 점검 내용</th><th>평가</th><th>평가 의견</th><th></th></tr></thead><tbody>' +
      L.basic.map(function (it) { return '<tr><td class="num">' + esc(it.no) + '</td><td>' + grp(it.group) + '</td><td class="wrap">' + esc(it.content) + '</td><td>' + sel(it.no, QA.B_MARKS) + '</td>' + note(it.no) + fb(it.no) + '</tr>'; }).join('') + '</tbody></table></div>';
    if (L.detail.length) {
      last = null;
      h += '<h3>상세 점검</h3><div class="tablewrap"><table id="ed-detail"><thead><tr><th class="num">순</th><th>공정</th><th>점검항목</th><th class="wrap">점검 Point</th><th>점검결과</th><th>해당사항여부</th></tr></thead><tbody>' +
        L.detail.map(function (it) { var d = dv[it.no] || {}; return '<tr><td class="num">' + esc(it.no) + '</td><td>' + grp(it.process) + '</td><td>' + esc(it.item) + '</td><td class="wrap">' + esc(it.point) + '</td><td><select data-act="ed-detail" data-no="' + esc(it.no) + '" data-k="res">' + opts(QA.B_RESULTS, d.res, '—') + '</select></td><td><select data-act="ed-detail" data-no="' + esc(it.no) + '" data-k="apply">' + opts(['해당', '제외'], d.apply || '해당') + '</select></td></tr>'; }).join('') + '</tbody></table></div>';
    }
    h += '<h3>Issue List <small>Status 1~4 · 목표일(Target)이 지나고 실제 완료일(Actual)이 비면 기한 초과로 표시</small></h3><div class="tablewrap"><table id="ed-issues"><thead><tr><th class="num">No</th><th>단계</th><th>품번</th><th>장소</th><th>발생일</th><th>요청자</th><th class="wrap">개선요청사항</th><th class="wrap">원인 및 대책</th><th class="wrap">결과</th><th>개선담당자</th><th>Status</th><th>Target</th><th>Actual</th><th></th></tr></thead><tbody>' +
      (a.issues || []).map(function (x, i) {
        var c = function (k, type) { return '<td><' + (type === 'ta' ? 'textarea' : 'input type="' + (type || 'text') + '"') + ' data-act="ed-issue" data-i="' + i + '" data-k="' + k + '"' + (type === 'ta' ? '>' + esc(x[k]) + '</textarea>' : ' value="' + esc(x[k]) + '">') + '</td>'; };
        var over = x.target && !x.actual && x.target < S.today;
        return '<tr' + (over ? ' class="over"' : '') + '><td class="num">' + (i + 1) + '</td>' + c('stage') + c('partNo') + c('place') + c('date', 'date') + c('requester') + c('request', 'ta') + c('action', 'ta') + c('result', 'ta') + c('owner') +
          '<td><select data-act="ed-issue" data-i="' + i + '" data-k="status">' + opts(QA.ISSUE_STATUS.map(String), x.status) + '</select></td>' + c('target', 'date') + c('actual', 'date') + '<td>' + (over ? '<span class="tag bad">기한 초과</span> ' : '') + '<button class="btn xs danger" data-act="ed-issue-del" data-i="' + i + '">삭제</button></td></tr>';
      }).join('') + '</tbody></table></div><div class="btnrow tight" style="margin-top:8px"><button class="btn sm" data-act="ed-issue-add">이슈 행 추가</button></div>';
    return h;
  }
  function renderAuditSummary() {
    var box = $('ed-sum'); if (!box || !S.edit) return;
    var a = S.edit.audit, f = QA.formOf(S.db, a), s = QA.score(a.kind, f, a);
    var h = '';
    if (a.kind === 'B') {
      h += '<div class="sub">' + esc(s.stage) + ' 체크 결과(점수 없음)</div><div class="big" id="ed-total">' + (s.goodRatio == null ? '—' : QA.round1(s.goodRatio).toFixed(1) + '%') + '</div><div class="sub">양호 비율 <span class="tag calc">계산</span></div>' +
        '<div class="row"><span>양호</span><b>' + s.basic['양호'] + '</b></div><div class="row"><span>개선요</span><b>' + s.basic['개선요'] + '</b></div><div class="row"><span>미실시</span><b>' + s.basic['미실시'] + '</b></div>' +
        (s.stage === 'Pre-PSO' ? '<div class="row"><span>상세 OK · NG · N/A</span><b>' + s.detail.OK + ' · ' + s.detail.NG + ' · ' + s.detail['N/A'] + '</b></div><div class="row"><span>상세 제외</span><b>' + s.detail.excluded + '</b></div>' : '') +
        '<div class="row"><span>Issue</span><b>' + s.issues.count + '건</b></div>';
    } else {
      h += '<div class="sub">총점(백분율)</div><div class="big" id="ed-total">' + (s.pct == null ? 'N/A' : pct(s.pct)) + '</div>' +
        '<div class="row"><span>원점수 / 만점' + (a.kind !== 'A' ? '(N/A 제외)' : '') + '</span><b>' + esc(QA.rawText(s) || '—') + '</b></div>' +
        (a.kind !== 'C' ? '<div class="row"><span>판정</span><b id="ed-judge">' + tag(s.judge) + '</b></div>' : '<div class="row"><span>Red 공정</span><b id="ed-judge">' + s.red + '개</b></div>');
      h += '<table class="guide" style="margin-top:8px"><thead><tr><th>' + (a.kind === 'D' ? '구분' : '공정') + '</th>' + (a.kind === 'C' ? '<th class="num">총 합계</th><th class="num">유효</th><th class="num">환산</th><th class="num">점수</th><th>Grade</th>' : '<th class="num">원점수/만점</th><th class="num">%</th>') + '</tr></thead><tbody id="ed-groups">' +
        s.groups.map(function (g) { return a.kind === 'C' ? '<tr><td>' + esc(g.name) + '</td><td class="num">' + g.total + '</td><td class="num">' + g.valid + '</td><td class="num">' + g.conv + '</td><td class="num">' + (g.valid ? QA.round1(g.score10) : 0) + '</td><td>' + tag(g.grade) + '</td></tr>' : '<tr><td>' + esc(g.name) + '</td><td class="num">' + g.raw + '/' + g.max + '</td><td class="num">' + pct(g.pct) + '</td></tr>'; }).join('') + '</tbody></table>';
      s.rows.forEach(function (r) { var c = document.getElementById('cv-' + r.no); if (c) c.textContent = r.conv == null ? '' : r.conv; });
    }
    if (s.missing) h += '<p class="warn" style="margin-top:10px">미입력 ' + s.missing + '개' + (a.kind === 'B' ? '' : ' — 엑셀 양식과 같이 0 점으로 더했습니다') + '.</p>';
    if (s.invalid && s.invalid.length) h += '<p class="warn">허용되지 않는 값: ' + s.invalid.join(', ') + '번</p>';
    box.innerHTML = h;
    var prev = QA.previousOf(S.db, a), cp = QA.compare(S.db, prev, a), c = $('ed-cmp');
    if (!c) return;
    if (!cp) { c.innerHTML = '<h3>이전 Audit 대비</h3><p class="sub">이 업체의 이전 ' + esc(K[a.kind].name) + '가 없습니다(첫 Audit).</p>'; return; }
    c.innerHTML = '<h3>이전 Audit 대비 <small>' + cp.prevDate + ' 과 비교</small></h3><div class="stats" id="ed-cmp-stats">' +
      (a.kind === 'B' ? stat('이전 양호 비율', pct(cp.prevRatio) + '%') + stat('이번', pct(cp.curRatio) + '%') : stat('이전', pct(cp.prevPct)) + stat('이번', pct(cp.curPct))) + stat('증감', delta(cp.delta)) + '</div>' +
      (cp.sameForm ? (cp.items.length ? '<div class="tablewrap"><table><thead><tr><th class="num">번호</th><th class="wrap">점검 내용</th><th class="num">이전</th><th class="num">이번</th><th class="num">변화</th></tr></thead><tbody>' + cp.items.map(function (x) { return '<tr><td class="num">' + esc(x.no) + '</td><td class="wrap">' + esc(x.text) + '</td><td class="num">' + (x.before == null ? '—' : x.before) + '</td><td class="num">' + (x.after == null ? '—' : x.after) + '</td><td class="num">' + delta(x.diff) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="sub">항목별 입력이 이전과 같습니다.</p>') : '<p class="sub">이전 Audit 과 양식이 달라 항목별 비교는 하지 않고 백분율만 비교합니다.</p>');
  }
  function saveAudit() {
    var a = S.edit.audit;
    if (!a.date) { toast('실시일을 넣으세요'); return false; }
    var i = S.db.audits.map(function (x) { return x.id; }).indexOf(a.id);
    if (i >= 0) S.db.audits[i] = JSON.parse(JSON.stringify(a)); else S.db.audits.push(JSON.parse(JSON.stringify(a)));
    S.edit.isNew = false; save(); return true;
  }

  /* ---------- 개선조치 관리 ---------- */
  function scopedFindings() { var ids = scope().vendorIds; return S.db.findings.filter(function (f) { return ids.indexOf(f.vendorId) >= 0; }); }
  function viewFindings() {
    var all = scopedFindings(), c = QA.findingCounts(all, S.today), F = S.findFilter || { status: '', kind: '' };
    var list = all.filter(function (f) {
      var st = QA.findingStatus(f);
      if (F.status === '기한 초과' && !QA.isOverdue(f, S.today)) return false;
      if (F.status === '미완료' && !(st === '계획 미수립' || st === '개선 진행중')) return false;
      if (F.status && F.status !== '기한 초과' && F.status !== '미완료' && st !== F.status) return false;
      if (F.kind && (f.kind || 'P') !== F.kind) return false;
      return true;
    }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var h = '<div class="card"><div class="head"><h2>개선조치 관리</h2>' + (scope().mode === 'vendor' ? '<button class="btn primary" id="btn-new-finding" data-act="new-finding">지적사항 직접 등록</button>' : '<span class="sub">새 지적은 업체를 고른 뒤 등록합니다</span>') + '</div>' +
      '<div class="stats" id="find-stats">' + stat('전체', c.total + '건') + stat('계획 미수립(미착수)', c['계획 미수립'] + '건', c['계획 미수립'] ? 'bad' : '') + stat('개선 진행중', c['개선 진행중'] + '건') + stat('개선 완료', c['개선 완료'] + '건') + stat('확인 완료', c['확인 완료'] + '건', 'good') + stat('기한 초과', c.overdue + '건', c.overdue ? 'bad' : 'good') + stat('재발', c.recur + '건') + '</div>' +
      '<div class="form"><label>결과 <select id="f-status" data-act="f-filter" data-k="status">' + opts(['미완료', '기한 초과'].concat(QA.STATUS), F.status, '전체') + '</select></label><label>Audit 종류 <select id="f-kind" data-act="f-filter" data-k="kind">' + opts(QA.ORDER.map(function (k) { return { v: k, t: K[k].name }; }).concat([{ v: 'P', t: '공정점검' }]), F.kind, '전체') + '</select></label></div>' +
      '<p class="sub">결과는 양식의 식대로 정합니다 — 계획일정이 없으면 「계획 미수립」, 완료일정이 없으면 「개선 진행중」, 있으면 「개선 완료」, 품질 담당자 확인일이 있으면 「확인 완료」. 계획일정(없으면 완료 요청일)이 지났는데 끝나지 않았으면 기한 초과입니다.</p>' +
      findingTable(list, 'find-table') + '</div>';
    if (S.findEdit) h += findingEditor();
    var rep = QA.repeatAnalysis(all, labelOfFinding);
    h += '<div class="card" id="repeat"><h3 style="margin-top:0">반복 지적사항 <small>같은 원인 항목(번호가 없으면 공정+유형)이 2번 이상</small></h3>' + (rep.length ? '<div class="tablewrap"><table><thead><tr><th>Audit 종류</th><th class="wrap">항목</th><th class="num">지적 횟수</th><th class="num">업체 수</th><th class="num">미완료</th><th>최근 지적일</th></tr></thead><tbody>' +
      rep.map(function (g) { return '<tr><td>' + esc(g.kind ? K[g.kind].name : '공정점검') + '</td><td class="wrap">' + esc(g.label) + '</td><td class="num"><b>' + g.count + '</b></td><td class="num">' + g.vendorCount + '</td><td class="num">' + g.open + '</td><td>' + esc(g.last) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="sub">반복된 지적이 없습니다.</p>') + '</div>';
    return h;
  }
  function labelOfFinding(f) {
    if (f.kind && f.itemNo) {
      var au = S.db.audits.filter(function (a) { return a.id === f.auditId; })[0];
      var form = au ? QA.formOf(S.db, au) : QA.activeForm(S.db, f.kind), it = null;
      if (form) { var list = form.kind === 'B' ? (form.preBasic || []).concat(form.psoBasic || []) : form.items; it = list.filter(function (x) { return x.no === f.itemNo; })[0]; }
      return f.itemNo + '번 ' + (it ? (it.content || it.item) : '') + (f.process ? ' (' + f.process + ')' : '');
    }
    return (f.process || '공정 미입력') + ' · ' + (f.type || '');
  }
  function newFinding(base) {
    var sc = scope(), v = sc.vendor;
    var f = { id: QA.uid('f'), auditId: '', vendorId: v.id, kind: '', itemNo: '', date: S.today, type: '공정', process: '', evaluator: mname(v.managerId), finding: '', why1: '', why2: '', why3: '', measure: '', dept: '', dueDate: QA.addDays(S.today, 30), planDate: '', doneDate: '', verifiedDate: '', verifier: '', recur: '', note: '', beforePhotos: [], afterPhotos: [], log: [{ date: S.today, text: '지적 등록' }] };
    Object.keys(base || {}).forEach(function (k) { f[k] = base[k]; });
    f.recur = QA.recurOf(f, S.db.findings);
    S.db.findings.push(f); save();
    S.findEdit = JSON.parse(JSON.stringify(f));
    return f;
  }
  function findingEditor() {
    var f = S.findEdit, st = QA.findingStatus(f), ov = QA.isOverdue(f, S.today), sug = QA.recurOf(f, S.db.findings);
    var inp = function (k, label, type, cls) { return '<label class="' + (cls || '') + '">' + label + ' <input type="' + (type || 'text') + '" data-act="fe" data-k="' + k + '" value="' + esc(f[k]) + '"></label>'; };
    var ta = function (k, label, cls) { return '<label class="' + (cls || 'span2') + '">' + label + ' <textarea data-act="fe" data-k="' + k + '" rows="2">' + esc(f[k]) + '</textarea></label>'; };
    return '<div class="card" id="find-edit"><div class="head"><h2>지적사항 — ' + esc(vname(f.vendorId)) + '</h2><span id="fe-status">' + stTag(st) + (ov ? ' <span class="tag bad">기한 초과</span>' : '') + '</span></div>' +
      '<h3>평가자 작성</h3><div class="form">' + inp('date', '평가일', 'date') + '<label>유형 <select data-act="fe" data-k="type">' + opts(QA.FINDING_TYPES, f.type) + '</select></label>' + inp('process', '공정명') + inp('evaluator', '평가자') + inp('dueDate', '완료 요청일', 'date') +
      ta('finding', '지적사항', 'full') + '</div>' + photoCell('fe', 'beforePhotos', f.beforePhotos, '관련사진') +
      '<h3>수검자(업체) 작성</h3><div class="form">' + ta('why1', '원인분석 1 why') + ta('why2', '2 why') + ta('why3', '3 why') + ta('measure', '재발방지 개선대책', 'full') + inp('dept', '개선부서/담당') + inp('planDate', '계획일정', 'date') + inp('doneDate', '완료일정', 'date') + '</div>' + photoCell('fe', 'afterPhotos', f.afterPhotos, '개선사진') +
      '<h3>품질 담당자 확인</h3><div class="form">' + inp('verifiedDate', '확인일', 'date') + inp('verifier', '확인자') + '<label>재발유무 <select data-act="fe" data-k="recur">' + opts(['신규', '재발'], f.recur) + '</select></label><span class="sub">자동 판정: <b>' + sug + '</b> (같은 업체·같은 원인 항목의 이전 지적 여부)</span>' + ta('note', '비고', 'full') + '</div>' +
      '<h3>조치 이력</h3><ul class="log">' + (f.log || []).map(function (l) { return '<li>' + esc(l.date) + ' — ' + esc(l.text) + '</li>'; }).join('') + '</ul><div class="form"><label class="span2">이력 추가 <input id="fe-log" placeholder="예: 업체 개선 계획 회신"></label><button class="btn sm" data-act="fe-log">이력 추가</button></div>' +
      '<div class="btnrow"><button class="btn primary" id="btn-save-finding" data-act="save-finding">지적사항 저장</button><button class="btn" data-act="close-finding">닫기</button><button class="btn danger" data-act="del-finding">삭제</button></div></div>';
  }
  function photoCell(scopeKey, field, list, label, i) {
    var di = i == null ? '' : ' data-i="' + i + '"';
    return '<div class="photos">' + (label ? '<span class="sub" style="width:100%">' + esc(label) + ' ' + (list || []).length + '장</span>' : '') +
      (list || []).map(function (p, j) { return '<div class="ph"><img src="' + esc(S.photos[p.id] || '') + '" alt="' + esc(p.caption || '사진') + '" data-act="zoom" data-id="' + esc(p.id) + '"><input type="text" placeholder="사진 설명" data-act="ph-cap" data-s="' + scopeKey + '" data-f="' + field + '" data-j="' + j + '"' + di + ' value="' + esc(p.caption) + '"><button class="x" title="사진 빼기" data-act="ph-del" data-s="' + scopeKey + '" data-f="' + field + '" data-j="' + j + '"' + di + '>×</button></div>'; }).join('') +
      '<label class="addph">+ 사진<input type="file" accept="image/*" multiple data-act="ph-add" data-s="' + scopeKey + '" data-f="' + field + '"' + di + '></label></div>';
  }

  /* ---------- 점수 분석 ---------- */
  function viewAnalysis() {
    var sc = scope(), h = '';
    if (!S.db.vendors.length) return '<div class="card empty"><h2>분석할 업체가 없습니다</h2><p class="sub">대시보드에서 예제를 넣거나 업체와 Audit 를 등록하세요.</p></div>';
    if (sc.mode === 'vendor') {
      var v = sc.vendor, im = QA.improvement(S.db, v.id, S.today);
      h += '<div class="card"><h2>' + esc(v.name) + ' — Audit 점수 분석</h2><div class="chart" id="an-line">' + lineChart(QA.series(S.db, v.id), { refs: [{ y: 90, label: '90', cls: 'g' }, { y: 75, label: '75' }] }) + '</div>' +
        '<h3>종류별 개선 효과 <small>첫 Audit → 최근 Audit 백분율</small></h3>' + improveTable([{ v: v, im: im }]) +
        '<p class="sub">개선조치 완료율 ' + pct(im.closeRate) + '% (완료·확인 ' + im.counts.closed + ' / 전체 ' + im.counts.total + ')</p></div>';
    } else {
      var rows = sc.vendorIds.map(function (id) { return QA.vendorRow(S.db, id, S.today); });
      var bars = rows.map(function (r) { var o = { label: vname(r.vendorId), values: {} }; QA.SCORED.forEach(function (x) { o.values[x] = r.last[x] ? r.last[x].pct : null; }); return o; });
      h += '<div class="card"><h2>Audit 점수 분석 — ' + (sc.mode === 'manager' ? esc(mname(sc.managerId)) + ' 담당' : '전체 업체') + '</h2><div class="chart" id="an-bars">' + barChart(bars, ['C', 'A', 'D']) + '</div>';
      h += '<h3>Audit 종류별 비교 <small>업체마다 최근 Audit 기준</small></h3><div class="tablewrap"><table id="kind-compare"><thead><tr><th>종류</th><th class="num">실시 업체</th><th class="num">평균 백분율</th><th class="num">최저</th><th class="num">최고</th><th class="num">평균 원점수 / 만점</th></tr></thead><tbody>' +
        QA.SCORED.map(function (k) {
          var L = rows.map(function (r) { return r.last[k]; }).filter(function (x) { return x && x.pct != null; });
          if (!L.length) return '<tr><td>' + esc(K[k].name) + '</td><td class="num">0</td><td colspan="4" class="sub">이력 없음</td></tr>';
          var ps = L.map(function (x) { return x.pct; });
          var ar = L.reduce(function (s, x) { return s + x.s.raw; }, 0) / L.length, am = L.reduce(function (s, x) { return s + x.s.max; }, 0) / L.length;
          return '<tr><td>' + esc(K[k].name) + '</td><td class="num">' + L.length + '</td><td class="num"><b>' + pct(ps.reduce(function (a, b) { return a + b; }, 0) / ps.length) + '</b></td><td class="num">' + pct(Math.min.apply(null, ps)) + '</td><td class="num">' + pct(Math.max.apply(null, ps)) + '</td><td class="num">' + QA.round1(ar) + ' / ' + QA.round1(am) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="sub">종류마다 배점이 달라 원점수끼리는 비교하지 않습니다 — 비교는 백분율로, 원점수는 참고로 함께 둡니다. PSO 는 점수가 없는 체크형이라 이 표에서 뺐습니다.</p>';
      h += '<h3>업체별 평균 점수 · 개선 효과</h3>' + improveTable(sc.vendorIds.map(function (id) { return { v: vendor(id), im: QA.improvement(S.db, id, S.today), avg: rows.filter(function (r) { return r.vendorId === id; })[0].avgPct }; })) + '</div>';
    }
    var weak = QA.weakProcesses(S.db, sc.vendorIds);
    h += '<div class="card" id="weak"><h3 style="margin-top:0">취약 공정 <small>최근 Audit 의 공정(구분)별 백분율 평균이 낮은 순 · 지적 건수</small></h3><div class="tablewrap"><table><thead><tr><th>Audit 종류</th><th>공정·구분</th><th class="num">평균 백분율</th><th class="num">업체 수</th><th class="num">지적 건수</th><th class="num">미완료</th></tr></thead><tbody>' +
      weak.slice(0, 10).map(function (g) { return '<tr><td>' + esc(K[g.kind].name) + '</td><td>' + esc(g.name) + '</td><td class="num">' + (g.avgPct == null ? '—' : '<b>' + pct(g.avgPct) + '</b>') + '</td><td class="num">' + g.n + '</td><td class="num">' + g.findings + '</td><td class="num">' + g.open + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    var rep = QA.repeatAnalysis(scopedFindings(), labelOfFinding);
    h += '<div class="card"><h3 style="margin-top:0">반복 지적사항</h3>' + (rep.length ? '<ul class="log">' + rep.slice(0, 8).map(function (g) { return '<li><b>' + g.count + '회</b> · ' + esc(g.kind ? K[g.kind].name : '공정점검') + ' · ' + esc(g.label) + ' (업체 ' + g.vendorCount + '곳, 미완료 ' + g.open + ')</li>'; }).join('') + '</ul>' : '<p class="sub">반복된 지적이 없습니다.</p>') + '</div>';
    return h;
  }
  function improveTable(list) {
    return '<div class="tablewrap"><table id="improve"><thead><tr><th>업체</th>' + (list[0] && list[0].avg !== undefined ? '<th class="num">평균</th>' : '') + '<th>종류</th><th class="num">횟수</th><th>첫 Audit</th><th class="num">첫 점수</th><th>최근 Audit</th><th class="num">최근 점수</th><th class="num">변화</th><th class="num">개선조치 완료율</th></tr></thead><tbody>' +
      list.map(function (x) {
        if (!x.im.kinds.length) return '<tr><td>' + esc(x.v.name) + '</td>' + (x.avg !== undefined ? '<td class="num">—</td>' : '') + '<td colspan="8" class="sub">점수형 Audit 이력 없음</td></tr>';
        return x.im.kinds.map(function (k, i) { return '<tr><td>' + (i ? '' : '<b>' + esc(x.v.name) + '</b>') + '</td>' + (x.avg !== undefined ? '<td class="num">' + (i ? '' : pct(x.avg)) + '</td>' : '') + '<td>' + esc(K[k.kind].name) + '</td><td class="num">' + k.n + '</td><td>' + k.firstDate + '</td><td class="num">' + pct(k.first) + '</td><td>' + k.lastDate + '</td><td class="num">' + pct(k.last) + '</td><td class="num">' + delta(k.change) + '</td><td class="num">' + (i ? '' : pct(x.im.closeRate) + '%') + '</td></tr>'; }).join('');
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- 공정점검 ---------- */
  function viewInspect() {
    var sc = scope();
    if (sc.mode !== 'vendor') return needVendor('공정점검');
    var list = S.db.inspections.filter(function (x) { return x.vendorId === sc.vendor.id; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var h = '<div class="card"><div class="head"><h2>공정점검 — ' + esc(sc.vendor.name) + '</h2><button class="btn primary" id="btn-new-insp" data-act="new-insp">새 공정점검</button></div>' +
      (list.length ? '<div class="tablewrap"><table id="insp-list"><thead><tr><th>점검 일자</th><th>대상 공정</th><th>점검 목적</th><th>점검 담당</th><th class="num">항목</th><th class="num">문제점</th><th class="num">사진</th><th class="num">완료</th><th></th></tr></thead><tbody>' +
        list.map(function (x) { var c = QA.inspectionSummary(x); return '<tr' + (S.inspEdit && S.inspEdit.id === x.id ? ' class="sel"' : '') + '><td>' + esc(x.date) + '</td><td>' + esc(x.target) + '</td><td class="wrap">' + esc(x.purpose) + '</td><td>' + esc(mname(x.inspectorId)) + '</td><td class="num">' + c.rows + '</td><td class="num">' + c.problems + '</td><td class="num">' + c.photos + '</td><td class="num">' + c.done + '/' + c.rows + '</td><td><button class="btn xs" data-act="open-insp" data-id="' + x.id + '">열기</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="sub">공정점검 이력이 없습니다.</p>') + '</div>';
    if (S.inspEdit) h += inspEditor();
    return h;
  }
  function newInsp() {
    S.inspPaste = false; S.inspPasteMsg = null;
    var v = scope().vendor;
    S.inspEdit = { id: QA.uid('i'), vendorId: v.id, date: S.today, purpose: '', target: '', inspectorId: v.managerId || '', attendees: '', vendorPlan: '', overall: '', rows: [blankRow(), blankRow(), blankRow()], isNew: true };
  }
  function blankRow() { return { process: '', item: '', check: '', problem: '', problemPhotos: [], request: '', fixPhotos: [], owner: '', due: '', state: '요청' }; }
  function inspEditor() {
    var x = S.inspEdit;
    var c = function (i, k, type) { var r = x.rows[i]; return type === 'ta' ? '<textarea data-act="ir" data-i="' + i + '" data-k="' + k + '">' + esc(r[k]) + '</textarea>' : '<input type="' + (type || 'text') + '" data-act="ir" data-i="' + i + '" data-k="' + k + '" value="' + esc(r[k]) + '">'; };
    return '<div class="card" id="insp-edit"><h2>' + (x.isNew ? '새 공정점검' : '공정점검 ' + esc(x.date)) + '</h2>' +
      '<div class="form"><label>점검 일자 <input type="date" data-act="ih" data-k="date" value="' + esc(x.date) + '"></label><label>업체명 <input value="' + esc(vname(x.vendorId)) + '" disabled></label><label class="span2">점검 목적 <input id="ih-purpose" data-act="ih" data-k="purpose" value="' + esc(x.purpose) + '"></label><label>대상 공정 <input id="ih-target" data-act="ih" data-k="target" value="' + esc(x.target) + '"></label>' +
      '<label>점검 담당자 <select data-act="ih" data-k="inspectorId">' + opts(S.db.managers.map(function (m) { return { v: m.id, t: m.name }; }), x.inspectorId, '(없음)') + '</select></label><label class="span2">참석자 <input data-act="ih" data-k="attendees" value="' + esc(x.attendees) + '"></label></div>' +
      '<p class="sub">엑셀처럼 가로로 적습니다. 문제점과 개선 요청사항은 나란히 두어 비교합니다. 표가 넓으면 가로로 밀어 보세요. 사진은 긴 변 1280px 로 줄여 이 브라우저에 저장합니다.</p>' +
      '<div class="tablewrap insp"><table id="insp-table"><thead><tr><th class="num">No.</th><th>점검 공정</th><th>점검 항목</th><th>확인 내용</th><th>문제점</th><th>문제점 사진</th><th>개선 요청사항</th><th>개선 사진</th><th>담당자</th><th>완료 예정일</th><th>진행상태</th><th></th></tr></thead><tbody>' +
      x.rows.map(function (r, i) {
        return '<tr><td class="num">' + (i + 1) + '</td><td>' + c(i, 'process') + '</td><td>' + c(i, 'item') + '</td><td>' + c(i, 'check', 'ta') + '</td><td class="pair">' + c(i, 'problem', 'ta') + '</td><td class="pair">' + photoCell('ir', 'problemPhotos', r.problemPhotos, '', i) + '</td>' +
          '<td class="pair">' + c(i, 'request', 'ta') + '</td><td class="pair">' + photoCell('ir', 'fixPhotos', r.fixPhotos, '', i) + '</td><td>' + c(i, 'owner') + '</td><td>' + c(i, 'due', 'date') + '</td><td><select data-act="ir" data-i="' + i + '" data-k="state">' + opts(QA.INSPECT_STATES, r.state) + '</select></td><td><button class="btn xs danger" data-act="ir-del" data-i="' + i + '">행 삭제</button></td></tr>';
      }).join('') + '</tbody></table></div><div class="btnrow tight" style="margin-top:8px"><button class="btn sm" id="btn-add-row" data-act="ir-add">행 추가</button><button class="btn sm" id="btn-insp-paste" data-act="insp-paste-open">엑셀에서 복사해 붙여넣기</button></div>' +
      (S.inspPasteMsg ? '<div class="' + (/넣었습니다/.test(S.inspPasteMsg[0]) ? 'ok' : 'warn') + '" id="insp-paste-msg">' + S.inspPasteMsg.map(esc).join('<br>') + '</div>' : '') +
      (S.inspPaste ? '<div class="card inner" id="insp-paste"><h3>점검표를 엑셀에서 붙여넣기</h3><p class="sub">엑셀에 적어 둔 점검표를 머리글 줄과 함께 복사(Ctrl+C)해 붙여 넣으세요. 머리글(점검 공정 · 점검 항목 · 확인 내용 · 문제점 · 개선 요청사항 · 담당자 · 완료 예정일 · 진행상태)로 열을 찾습니다. 머리글이 없으면 이 순서대로 읽습니다. 날짜는 2026-11-04 · 2026.11.4 · 2026년 11월 4일 · 11/4 모두 됩니다. 사진은 붙여넣기로 옮겨지지 않으니 표에서 붙여 주세요.</p>' +
        '<textarea id="insp-paste-text" class="paste" rows="6" placeholder="여기에 붙여 넣으세요 (Ctrl+V)"></textarea><div class="btnrow tight"><button class="btn primary" id="btn-insp-paste-read" data-act="insp-paste-read">행으로 넣기</button><button class="btn" data-act="insp-paste-open">닫기</button></div></div>' : '') +
      '<div class="form"><label class="full">업체 조치계획 <textarea data-act="ih" data-k="vendorPlan" rows="2">' + esc(x.vendorPlan) + '</textarea></label><label class="full">종합 의견 <textarea data-act="ih" data-k="overall" rows="2">' + esc(x.overall) + '</textarea></label></div>' +
      '<div class="btnrow"><button class="btn primary" id="btn-save-insp" data-act="save-insp">점검 결과 저장</button><button class="btn" id="btn-to-mail" data-act="insp-mail">이 점검으로 메일 만들기</button><button class="btn" data-act="insp-findings">문제점을 지적사항으로 등록</button><button class="btn" data-act="close-insp">닫기</button>' + (x.isNew ? '' : '<button class="btn danger" data-act="del-insp">삭제</button>') + '</div></div>';
  }
  function saveInsp() {
    var x = JSON.parse(JSON.stringify(S.inspEdit)); delete x.isNew;
    var i = S.db.inspections.map(function (y) { return y.id; }).indexOf(x.id);
    if (i >= 0) S.db.inspections[i] = x; else S.db.inspections.push(x);
    S.inspEdit.isNew = false; save();
  }

  /* ---------- 메일 ---------- */
  function viewMail() {
    var sc = scope();
    if (sc.mode !== 'vendor') return needVendor('메일 자동 생성');
    var list = S.db.inspections.filter(function (x) { return x.vendorId === sc.vendor.id; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!list.length) return '<div class="card empty"><h2>공정점검 결과가 없습니다</h2><p class="sub">메일은 공정점검 결과로 만듭니다. 먼저 <a href="#/inspect">공정점검 관리</a>에서 점검을 저장하세요.</p></div>';
    if (!S.mail || S.mail.vendorId !== sc.vendor.id) S.mail = { vendorId: sc.vendor.id, inspId: list[0].id, type: 'internal', draft: null };
    var m = S.mail, insp = list.filter(function (x) { return x.id === m.inspId; })[0] || list[0];
    m.inspId = insp.id;
    if (!m.draft) m.draft = makeDraft(m.type, insp);
    var d = m.draft;
    var h = '<div class="card"><h2>메일 자동 생성 — ' + esc(sc.vendor.name) + '</h2><div class="form"><label class="span2">공정점검 <select id="mail-insp" data-act="mail-insp">' + opts(list.map(function (x) { return { v: x.id, t: x.date + ' · ' + (x.target || '대상 공정 미입력') }; }), insp.id) + '</select></label></div>' +
      '<div class="btnrow tight"><button class="btn ' + (m.type === 'internal' ? 'on' : '') + '" id="mail-internal" data-act="mail-type" data-t="internal">파트장·팀장 보고용</button><button class="btn ' + (m.type === 'vendor' ? 'on' : '') + '" id="mail-vendor" data-act="mail-type" data-t="vendor">협력업체 발송용</button><button class="btn sm" data-act="mail-regen">다시 만들기</button></div>' +
      (d.missing.length ? '<div class="warn" id="mail-missing">입력되지 않은 정보: ' + esc(d.missing.join(' · ')) + ' — 임의로 채우지 않고 「(입력 없음)」으로 두었습니다. 공정점검에서 채운 뒤 다시 만드세요.</div>' : '<div class="ok" id="mail-missing">점검 결과의 필수 정보가 모두 들어갔습니다.</div>') +
      '<div class="form"><label class="span2">받는 사람 <input id="mail-to" value="' + esc(d.to) + '" placeholder="이메일 주소(선택)"></label><label class="full">제목 <input id="mail-subject" data-act="mail-edit" data-k="subject" value="' + esc(d.subject) + '"></label></div>' +
      '<textarea class="big mail" id="mail-body" data-act="mail-edit" data-k="body">' + esc(d.body) + '</textarea>' +
      '<div class="btnrow"><button class="btn primary" id="btn-copy" data-act="mail-copy">제목·본문 복사</button><a class="btn" id="btn-mailto" data-act="mail-open" href="' + esc(QA.mailto(d.to, d.subject, d.body)) + '">메일 프로그램으로 열기</a><button class="btn" id="btn-save-mail" data-act="mail-save">메일 이력에 저장</button><button class="btn" data-act="mail-ai">AI 로 문장 다듬기(선택)</button></div>' +
      '<p class="sub">메일 프로그램으로 열기는 사진을 붙이지 못합니다. 아래 사진을 내려받아 직접 첨부하세요. 본문이 아주 길면 일부 메일 프로그램이 잘라 읽으니 복사해 붙여넣기를 권합니다.</p>' +
      mailPhotos(insp) + '<div id="ai-out"></div></div>';
    var hist = S.db.mails.filter(function (x) { return x.vendorId === sc.vendor.id; }).slice().reverse();
    h += '<div class="card"><h3 style="margin-top:0">메일 작성 이력</h3>' + (hist.length ? '<div class="tablewrap"><table id="mail-hist"><thead><tr><th>작성일</th><th>유형</th><th class="wrap">제목</th><th></th></tr></thead><tbody>' + hist.map(function (x) { return '<tr><td>' + esc(x.created) + '</td><td>' + (x.type === 'internal' ? '내부 보고' : '업체 발송') + '</td><td class="wrap">' + esc(x.subject) + '</td><td><button class="btn xs" data-act="mail-load" data-id="' + x.id + '">불러오기</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="sub">저장한 메일이 없습니다.</p>') + '</div>';
    return h;
  }
  function makeDraft(type, insp) {
    var v = vendor(insp.vendorId), mg = manager(insp.inspectorId);
    var d = QA.buildMail(type, insp, { vendorName: v ? v.name : '', inspectorName: mg ? mg.name : '' });
    var boss = v ? manager(v.managerId) : null;
    d.to = type === 'vendor' ? (v && v.email) || '' : (boss && boss.email) || '';
    return d;
  }
  function mailPhotos(insp) {
    var ps = [];
    (insp.rows || []).forEach(function (r, i) { (r.problemPhotos || []).forEach(function (p) { ps.push({ p: p, t: (i + 1) + '번 문제점' }); }); (r.fixPhotos || []).forEach(function (p) { ps.push({ p: p, t: (i + 1) + '번 개선' }); }); });
    if (!ps.length) return '';
    return '<h3>점검 사진 <small>' + ps.length + '장</small></h3><div class="photos" id="mail-photos">' + ps.map(function (x, j) { var src = S.photos[x.p.id] || ''; return '<div class="ph"><img src="' + esc(src) + '" alt="' + esc(x.p.caption || x.t) + '" data-act="zoom" data-id="' + esc(x.p.id) + '"><a class="sub" style="font-size:11.5px" download="' + esc('점검사진_' + (j + 1) + '_' + (x.p.caption || x.t)) + (/^data:image\/svg/.test(src) ? '.svg' : '.jpg') + '" href="' + esc(src) + '">' + esc(x.t) + ' 내려받기</a></div>'; }).join('') + '</div>';
  }
  function aiPolish() {
    var d = S.mail.draft, cfg = aiCfg();
    if (!cfg.key) { $('ai-out').innerHTML = '<div class="ai-box">AI 키가 없습니다. 「데이터 관리」에서 키를 넣으면 쓸 수 있습니다. 키 없이도 메일 초안은 그대로 쓸 수 있습니다.</div>'; return; }
    if (!confirm('메일 제목·본문을 외부 AI(' + (cfg.provider === 'anthropic' ? 'Anthropic' : 'OpenAI') + ')로 보냅니다.\n업체명·지적사항 같은 사내 자료가 들어 있습니다. 회사 보안 규정상 보내도 되는지 확인했습니까?')) return;
    var prompt = '다음 업무 메일을 ' + (d.type === 'internal' ? '간결하고 객관적인 내부 보고' : '정중하고 공식적인 협력업체 발송') + ' 문체로 다듬어 줘. 사실·숫자·날짜·업체명은 바꾸거나 더하지 말고, 「(입력 없음)」 부분은 그대로 둬. 본문만 돌려줘.\n\n제목: ' + d.subject + '\n\n' + d.body;
    $('ai-out').innerHTML = '<div class="ai-box">AI 에 보내는 중…</div>';
    var req = cfg.provider === 'anthropic'
      ? fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) }).then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error.message); return j.content[0].text; })
      : fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.key }, body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }) }).then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error.message); return j.choices[0].message.content; });
    req.then(function (t) {
      S.mail.ai = t;
      $('ai-out').innerHTML = '<div class="ai-box"><b>AI 초안 — 검토 필요</b><textarea class="big mail" id="ai-text" readonly>' + esc(t) + '</textarea><div class="btnrow tight" style="margin-top:8px"><button class="btn sm" data-act="ai-use">이 문장으로 본문 바꾸기</button></div></div>';
    }).catch(function (e) { $('ai-out').innerHTML = '<div class="warn">AI 호출 실패: ' + esc(e.message) + '</div>'; });
  }
  function aiCfg() { try { return JSON.parse(localStorage.getItem('qa14.ai') || '{}'); } catch (e) { return {}; } }

  /* ---------- 데이터 관리 ---------- */
  function viewData() {
    var h = '<div class="card"><h2>Audit 양식</h2><p>회사 양식 엑셀(.xlsx)을 올리면 <b>머리글 낱말로 표를 찾아</b> 항목 · 배점 · 가중치 · CTQ · 선택지 · 공정 묶음을 그대로 읽어 「양식 정의」로 저장합니다. 항목과 배점은 바꾸지 않습니다.</p>' +
      '<p class="sub">엑셀 파일은 서버로 올라가지 않습니다 — 이 브라우저 안에서 읽고, 항목 정의만 이 PC 에 저장합니다. 지금 들어 있는 「예제 양식」은 지어낸 항목입니다.</p>' +
      '<div class="tablewrap"><table id="form-table"><thead><tr><th>종류</th><th>쓰는 양식</th><th class="num">항목</th><th class="num">만점</th><th>출처</th><th>양식 엑셀 올리기</th></tr></thead><tbody>' +
      QA.ORDER.map(function (k) {
        var list = S.db.forms.filter(function (f) { return f.kind === k; }), act = QA.activeForm(S.db, k);
        return '<tr><td><b>' + esc(K[k].name) + '</b></td><td><select data-act="form-active" data-kind="' + k + '">' + opts(list.map(function (f) { return { v: f.id, t: f.name }; }), act && act.id) + '</select></td><td class="num">' + QA.formSize(act) + '</td><td class="num">' + (k === 'B' ? '—' : QA.formMax(act)) + '</td><td class="wrap">' + esc(act.source) + '</td>' +
          '<td><div class="btnrow tight"><label class="btn sm" for="form-file-' + k + '">파일 고르기</label><input type="file" id="form-file-' + k + '" accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt" data-act="form-file" data-kind="' + k + '">' +
          '<button class="btn sm" id="btn-paste-' + k + '" data-act="paste-open" data-kind="' + k + '">엑셀에서 복사해 붙여넣기</button></div></td></tr>';
      }).join('') + '</tbody></table></div><p class="sub">예제 양식 엑셀 4종은 저장소의 <code>samples/</code> 폴더에 있습니다(실제 회사 양식과 같은 모양, 항목은 지어낸 것).</p>' +
      '<div class="note">회사 노트북에서 엑셀 파일이 열리지 않으면(DRM · 보안 프로그램) 엑셀에서 <b>머리글 줄부터 표 끝까지 범위를 골라 복사(Ctrl+C)</b>한 뒤 「엑셀에서 복사해 붙여넣기」로 넣으세요. 파일과 같은 규칙으로 머리글 · 공정 묶음 · 배점을 읽습니다. CSV · TXT 파일도 고를 수 있습니다.</div>' +
      pastePanel() + '<div id="form-preview">' + formPreview() + '</div></div>';
    var n = S.db;
    h += '<div class="card"><h2>내보내기 · 백업</h2><div class="stats">' + stat('업체', n.vendors.length + '곳') + stat('Audit', n.audits.length + '건') + stat('지적사항', n.findings.length + '건') + stat('공정점검', n.inspections.length + '건') + stat('사진', Object.keys(S.photos).length + '장') + stat('메일 이력', n.mails.length + '건') + '</div>' +
      '<div class="btnrow"><button class="btn green" id="btn-export" data-act="export">엑셀로 내보내기(현재 선택 조건)</button><button class="btn" id="btn-backup" data-act="backup">전체 백업(JSON · 사진 포함)</button><label class="btn" for="restore-file">백업 복원</label><input type="file" id="restore-file" accept=".json,application/json" data-act="restore"></div>' +
      '<p class="sub" style="margin-top:10px">엑셀 시트: Audit결과 · 항목별점수 · 지적사항 · 공정점검 · 메일이력. 백업 파일에는 사내 자료와 사진이 그대로 들어 있습니다 — 보관·전달에 주의하세요.</p>' +
      '<h3>엑셀 파일을 받을 수 없을 때 — 표 복사</h3><p class="sub">내려받은 엑셀 파일이 열리지 않으면 표를 복사해 빈 엑셀 시트의 A1 칸에 붙여 넣으세요(Ctrl+V). 현재 선택 조건의 자료입니다.</p>' +
      '<div class="btnrow tight" id="copy-tables">' + ['Audit결과', '항목별점수', '지적사항', '공정점검', '메일이력'].map(function (nm) { return '<button class="btn sm" data-act="copy-sheet" data-sheet="' + nm + '">' + nm + ' 복사</button>'; }).join('') +
      '<button class="btn sm" data-act="csv-sheet" id="btn-csv">CSV 로 받기(시트 5개)</button></div>' +
      '<h3>백업 파일을 고를 수 없을 때</h3><div class="btnrow tight"><button class="btn sm" data-act="restore-paste-open" id="btn-restore-paste">백업 내용 붙여넣어 복원</button></div>' + (S.restorePaste ? '<div class="form"><label class="full">백업 JSON 내용 <textarea id="restore-text" rows="4" placeholder="백업 파일을 메모장으로 열어 전체 선택(Ctrl+A) · 복사한 뒤 여기에 붙여 넣으세요"></textarea></label><button class="btn primary" data-act="restore-paste">이 내용으로 복원</button></div>' : '') +
      '<div class="btnrow"><button class="btn" data-act="sample">예제로 바꾸기</button><button class="btn danger" data-act="clear">모두 지우기</button></div>' +
      '<div class="note">이 도구는 <b>한 PC 의 한 브라우저</b>에 저장하는 시제품입니다. 브라우저 데이터를 지우면 함께 사라지니 백업 파일을 주기적으로 받아 두세요. 여러 담당자가 같은 자료를 함께 쓰려면 별도 서버와 데이터베이스가 필요합니다(자료 구조는 그대로 옮길 수 있게 만들었습니다).</div></div>';
    h += offlineCard();
    var cfg = aiCfg();
    h += '<div class="card"><h2>AI 문장 다듬기(선택)</h2><p class="sub">메일 초안은 AI 없이 만들어집니다. AI 는 문장을 다듬는 보조로만 씁니다(인터넷이 필요합니다 — 폐쇄망에서는 쓰지 않아도 모든 기능이 그대로 됩니다). 키는 이 브라우저(localStorage)에만 저장되고, 보내기 전에 매번 확인을 묻습니다.</p>' +
      '<div class="form"><label>제공자 <select id="ai-provider" data-act="ai-cfg">' + opts([{ v: 'openai', t: 'OpenAI (gpt-4o-mini)' }, { v: 'anthropic', t: 'Anthropic (claude-haiku-5-5)' }], cfg.provider || 'openai') + '</select></label><label class="span2">API 키 <input type="password" id="ai-key" data-act="ai-cfg" value="' + esc(cfg.key || '') + '" autocomplete="off"></label></div></div>';
    return h;
  }
  function formPreview() {
    var d = S.formDraft;
    if (!d) return '';
    var r = d.result, k = d.kind;
    var h = '<h3>올린 양식 확인 — ' + esc(K[k].name) + ' <small>' + esc(d.file) + '</small></h3>';
    if (k !== 'B') {
      h += '<div class="form"><label>시트 <select data-act="fp-sheet">' + opts(d.names, r.sheet) + '</select></label>';
      h += '<label>머리글 줄 <input type="number" min="1" id="fp-hrow" data-act="fp-hrow" value="' + ((r.headerRow == null ? 0 : r.headerRow) + 1) + '"></label>';
      if (r.header) {
        Object.keys(QA.FIELDS[k]).forEach(function (f) {
          h += '<label>' + esc(QA.FIELD_LABEL[f]) + (QA.REQUIRED[k].indexOf(f) >= 0 ? ' *' : '') + ' <select data-act="fp-map" data-f="' + f + '">' + opts(r.header.map(function (c, j) { return { v: j, t: String.fromCharCode(65 + (j % 26)) + ' · ' + (c || '(빈 칸)') }; }), r.map[f], '(없음)') + '</select></label>';
        });
      }
      h += '</div><p class="sub">열을 잘못 찾았으면 위에서 직접 고르세요. * 는 꼭 있어야 하는 열입니다.</p>';
    }
    if (!r.ok) return h + '<div class="warn">' + esc(r.error) + '</div>';
    if (r.warnings.length) h += '<div class="warn">' + r.warnings.map(esc).join('<br>') + '</div>';
    var f = QA.makeForm(k, r, {});
    h += '<div class="ok" id="fp-ok">항목 ' + QA.formSize(f) + '개를 읽었습니다' + (k !== 'B' ? ' · 만점 ' + QA.formMax(f) : '') + '.</div>';
    var rows = k === 'B' ? [['Pre-PSO 기본', f.preBasic], ['Pre-PSO 상세', f.preDetail], ['PSO 기본', f.psoBasic]] : [['', f.items]];
    rows.forEach(function (x) {
      if (!x[1].length) return;
      h += (x[0] ? '<h3>' + x[0] + ' ' + x[1].length + '개</h3>' : '') + '<div class="tablewrap" style="max-height:320px"><table><thead><tr><th>번호</th><th>공정·구분</th><th class="wrap">내용</th>' + (k === 'A' ? '<th>CTQ</th><th class="num">가중치</th>' : k === 'C' ? '<th class="num">가중치</th>' : k === 'D' ? '<th class="num">배점</th><th>선택지</th>' : '') + '</tr></thead><tbody>' +
        x[1].map(function (it) { return '<tr><td>' + esc(it.no) + '</td><td>' + esc(it.process || it.group) + '</td><td class="wrap">' + esc(it.content || (it.item + (it.check ? ' — ' + it.check : it.point ? ' — ' + it.point : ''))) + '</td>' + (k === 'A' ? '<td>' + (it.ctq ? 'CTQ' : '') + '</td><td class="num">' + it.weight + '</td>' : k === 'C' ? '<td class="num">' + it.weight + '</td>' : k === 'D' ? '<td class="num">' + it.points + '</td><td>' + it.options.join(' / ') + ' / N/A</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>';
    });
    h += '<div class="form"><label class="span2">양식 이름 <input id="fp-name" value="' + esc(d.file.replace(/\.[^.]+$/, '')) + '"></label><button class="btn primary" id="btn-form-save" data-act="fp-save">이 양식 저장하고 쓰기</button><button class="btn" data-act="fp-cancel">취소</button></div>';
    return h;
  }
  // 엑셀에서 복사해 붙여넣기 — DRM 때문에 .xlsx 를 고를 수 없을 때. 읽기는 파일과 같은 QA.parseFormBook.
  function pastePanel() {
    var k = S.pasteKind; if (!k) return '';
    var d = S.formDraft && S.formDraft.pasted && S.formDraft.kind === k ? S.formDraft : null;
    var h = '<div class="card inner" id="paste-panel"><h3>엑셀에서 복사해 붙여넣기 — ' + esc(K[k].name) + '</h3>' +
      '<ol class="sub"><li>회사 양식 엑셀에서 <b>머리글 줄(예: ' + esc(QA.REQUIRED[k === 'B' ? 'Bb' : k].map(function (f) { return QA.FIELD_LABEL[f]; }).join(' · ')) + ')부터 마지막 항목까지</b> 골라 복사(Ctrl+C)합니다. 위쪽 제목 줄이 섞여도 됩니다.</li>' +
      '<li>아래 칸을 누르고 붙여 넣기(Ctrl+V) → 「붙여넣은 표 읽기」.</li>' + (k === 'B' ? '<li>PSO 는 시트마다 따로 붙여 넣습니다 — 부분을 고르고 읽은 뒤, 다음 부분을 고르고 다시 붙여 넣으면 함께 쌓입니다.</li>' : '') + '</ol>' +
      (k === 'B' ? '<div class="form"><label>부분 <select id="paste-part">' + opts([{ v: 'preBasic', t: 'Pre-PSO 기본(양호 · 개선요 · 미실시)' }, { v: 'preDetail', t: 'Pre-PSO 상세(점검항목 · 점검 Point)' }, { v: 'psoBasic', t: 'PSO 기본(양호 · 개선요 · 미실시)' }], S.pastePart || 'preBasic') + '</select></label>' +
        (d ? '<p class="sub span2">지금까지 붙인 부분: ' + esc(d.names.join(' · ')) + '</p>' : '') + '</div>' : '') +
      '<textarea id="paste-text" class="paste" rows="7" placeholder="여기에 엑셀 범위를 붙여 넣으세요 (Ctrl+V)"></textarea>' +
      '<div class="btnrow tight"><button class="btn primary" id="btn-paste-read" data-act="paste-read" data-kind="' + k + '">붙여넣은 표 읽기</button><button class="btn" data-act="paste-close">닫기</button></div></div>';
    return h;
  }
  function offlineCard() {
    if (OFFLINE) {
      return '<div class="card" id="offline-card"><h2>오프라인 파일로 쓰는 중</h2><p>이 화면은 내려받은 오프라인 파일(v' + esc(window.QA_OFFLINE.version) + ')입니다. 인터넷 없이 모든 기능이 됩니다 — 엑셀 읽기 · 내보내기 라이브러리까지 이 파일 하나에 들어 있습니다.</p>' +
        '<p class="sub">자료는 이 PC 의 이 브라우저에 저장됩니다. 온라인 주소에서 쓰던 자료와는 저장소가 따로라, 옮길 때는 「전체 백업」 → 여기서 「백업 복원」을 쓰세요. 파일 위치를 옮겨도 같은 브라우저면 자료가 이어지지만, 브라우저 기록을 지우면 함께 지워지니 백업을 자주 받아 두세요.</p></div>';
    }
    return '<div class="card" id="offline-card"><h2>폐쇄망 · 회사 노트북에서 쓰기</h2><p>인터넷이 안 되는 PC 에서는 <b>오프라인 사용 파일</b>(HTML 하나)을 받아 USB 등으로 옮긴 뒤 두 번 눌러 여세요. 화면 · 계산 · 엑셀 읽기/내보내기 라이브러리가 모두 그 파일 안에 들어 있어 서버나 인터넷 없이 돕니다.</p>' +
      '<div class="btnrow"><a class="btn primary" id="btn-offline" href="offline/qa-2611-14-offline.html" download="협력업체품질관리_오프라인.html">오프라인 사용 파일 받기</a></div>' +
      '<p class="sub">자료는 그 PC 브라우저에 따로 저장됩니다. 지금 자료를 가져가려면 「전체 백업」 파일을 함께 옮겨 오프라인 파일에서 「백업 복원」하세요. 새 판이 나오면 파일을 다시 받으면 되고, 자료는 그대로 남습니다.</p></div>';
  }
  function reparseDraft() {
    var d = S.formDraft;
    d.result = QA.parseFormBook(d.kind, d.sheets, d.names, d.opts);
  }
  function readXlsx(file) {
    return file.arrayBuffer().then(function (buf) {
      var ext = (file.name.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
      if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {   // 글자 파일은 붙여넣기와 같은 읽기(인코딩은 UTF-8 · CP949 자동)
        var pp = QA.parsePaste(QA.decodeText(new Uint8Array(buf)), ext === 'csv' ? { delim: ',' } : ext === 'tsv' ? { delim: '\t' } : {}), one = {};
        one[file.name] = pp.aoa;
        return { names: [file.name], sheets: one };
      }
      var wb = XLSX.read(buf, { type: 'array' }), sheets = {};
      wb.SheetNames.forEach(function (n) { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true }); });
      return { names: wb.SheetNames, sheets: sheets };
    });
  }
  function exportXlsx() {
    var rep = QA.reportSheets(S.db, scope().vendorIds, S.today), wb = XLSX.utils.book_new();
    rep.names.forEach(function (n) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rep.sheets[n]), n); });
    var sc = scope(), tag2 = sc.mode === 'vendor' ? sc.vendor.name : sc.mode === 'manager' ? mname(sc.managerId) : '전체';
    var out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    download('협력업체품질_' + tag2.replace(/[\\/:*?"<>|()\s]/g, '') + '_' + S.today + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }

  function restoreFrom(t) {
    var r2 = QA.restore(t);
    if (!r2.ok) { toast('복원 실패: ' + r2.error); return; }
    if (!confirm('지금 자료를 백업 파일 내용으로 바꿉니다. 계속할까요?')) return;
    S.restorePaste = false;
    S.db = r2.db; clearPhotos().then(function () { return Promise.all(r2.photos.map(function (p) { return putPhoto(p.id, p.data); })); }).then(function () { save(); setSel('', ''); toast('복원했습니다'); });
  }

  /* ---------- 사진 ---------- */
  function addPhotos(files) {
    return Promise.all(Array.prototype.map.call(files, function (file) {
      return new Promise(function (res) {
        var rd = new FileReader();
        rd.onload = function () {
          var img = new Image();
          img.onload = function () {
            var sz = QA.fitSize(img.naturalWidth, img.naturalHeight, 1280), cv = document.createElement('canvas');
            cv.width = sz.w; cv.height = sz.h; cv.getContext('2d').drawImage(img, 0, 0, sz.w, sz.h);
            var data = cv.toDataURL('image/jpeg', 0.82), id = QA.uid('p');
            putPhoto(id, data).then(function () { res({ id: id, caption: file.name.replace(/\.[^.]+$/, '') }); });
          };
          img.onerror = function () { res(null); };
          img.src = rd.result;
        };
        rd.readAsDataURL(file);
      });
    })).then(function (list) { return list.filter(Boolean); });
  }
  function photoTarget(el) {
    var s = el.getAttribute('data-s'), f = el.getAttribute('data-f'), i = el.getAttribute('data-i');
    if (s === 'fe') return S.findEdit[f];
    return S.inspEdit.rows[+i][f];
  }

  /* ---------- 이벤트 ---------- */
  function onClick(e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    if (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
    if (act === 'sample') {
      if (S.db.vendors.length && !confirm('지금 자료를 지우고 예제로 바꿉니다. 계속할까요?')) return;
      var smp = QA.sample(S.today); S.db = smp.db; S.db.sample = true;
      clearPhotos().then(function () { return Promise.all(smp.photos.map(function (p) { return putPhoto(p.id, p.data); })); }).then(function () { save(); setSel('', ''); go('dashboard'); toast('예제를 넣었습니다 — 실제 사내 데이터가 아닙니다'); });
    } else if (act === 'clear') {
      if (!confirm('이 브라우저에 저장된 모든 자료(업체·Audit·지적사항·사진·메일)를 지웁니다. 백업을 받았습니까?')) return;
      S.db = QA.emptyDb(); clearPhotos(); save(); setSel('', ''); go('dashboard');
    } else if (act === 'pick-vendor') { var v = vendor(id); setSel(v.managerId, v.id); }
    else if (act === 'open-audit') { var a = S.db.audits.filter(function (x) { return x.id === id; })[0]; S.edit = { kind: a.kind, audit: JSON.parse(JSON.stringify(a)), isNew: false }; go('audit/' + a.kind); setTimeout(function () { var ed = $('audit-editor'); if (ed) ed.scrollIntoView({ block: 'start' }); }, 30); }
    else if (act === 'new-audit') { newAudit(el.getAttribute('data-kind')); render(); $('audit-editor').scrollIntoView({ block: 'start' }); }
    else if (act === 'save-audit') { if (saveAudit()) { render(); toast('Audit 를 저장했습니다'); } }
    else if (act === 'close-audit') { S.edit = null; render(); }
    else if (act === 'del-audit') {
      if (!confirm('이 Audit 를 지웁니다. 연결된 지적사항은 남깁니다.')) return;
      S.db.audits = S.db.audits.filter(function (x) { return x.id !== S.edit.audit.id; }); S.edit = null; save(); render();
    } else if (act === 'add-finding') {
      if (!saveAudit()) return;
      var au = S.edit.audit, fm = QA.formOf(S.db, au), no = el.getAttribute('data-no');
      var list = au.kind === 'B' ? QA.bLists(fm, au.stage).basic : fm.items, it = list.filter(function (x) { return x.no === no; })[0];
      var val = (au.values || {})[no], txt = it.content || it.check || it.item;
      newFinding({ auditId: au.id, kind: au.kind, itemNo: no, date: au.date, type: au.kind === 'D' ? '도장' : it.ctq ? 'CTQ' : '공정', process: it.process || it.group, evaluator: au.auditor, finding: '「' + txt + '」' + (val != null && val !== '' ? ' — 평가 ' + val : '') + ((au.notes || {})[no] ? ' · ' + au.notes[no] : '') });
      go('findings'); setTimeout(function () { var fe = $('find-edit'); if (fe) fe.scrollIntoView({ block: 'start' }); }, 30);
    } else if (act === 'ed-issue-add') { S.edit.audit.issues.push({ no: S.edit.audit.issues.length + 1, stage: '', partNo: (S.edit.audit.product || {}).partNo || '', place: '', date: S.today, requester: S.edit.audit.auditor, request: '', action: '', result: '', owner: '', status: 1, target: '', actual: '' }); render(); }
    else if (act === 'ed-issue-del') { S.edit.audit.issues.splice(+el.getAttribute('data-i'), 1); render(); }
    else if (act === 'open-finding') { var f = S.db.findings.filter(function (x) { return x.id === id; })[0]; S.findEdit = JSON.parse(JSON.stringify(f)); if (S.route !== 'findings') go('findings'); else render(); setTimeout(function () { var fe = $('find-edit'); if (fe) fe.scrollIntoView({ block: 'start' }); }, 30); }
    else if (act === 'new-finding') { newFinding({}); render(); $('find-edit').scrollIntoView({ block: 'start' }); }
    else if (act === 'save-finding') {
      var i = S.db.findings.map(function (x) { return x.id; }).indexOf(S.findEdit.id);
      S.db.findings[i] = JSON.parse(JSON.stringify(S.findEdit)); save(); render(); toast('지적사항을 저장했습니다');
    } else if (act === 'close-finding') { S.findEdit = null; render(); }
    else if (act === 'del-finding') { if (!confirm('이 지적사항을 지웁니다.')) return; S.db.findings = S.db.findings.filter(function (x) { return x.id !== S.findEdit.id; }); S.findEdit = null; save(); render(); }
    else if (act === 'fe-log') { var t = $('fe-log').value.trim(); if (!t) return; S.findEdit.log.push({ date: S.today, text: t }); render(); }
    else if (act === 'ph-del') { photoTarget(el).splice(+el.getAttribute('data-j'), 1); render(); }
    else if (act === 'zoom') { var z = document.createElement('div'); z.className = 'zoom'; z.innerHTML = '<img src="' + esc(S.photos[id] || '') + '" alt="">'; z.onclick = function () { z.remove(); }; document.body.appendChild(z); }
    else if (act === 'new-insp') { newInsp(); render(); $('insp-edit').scrollIntoView({ block: 'start' }); }
    else if (act === 'open-insp') { var x = S.db.inspections.filter(function (y) { return y.id === id; })[0]; S.inspEdit = JSON.parse(JSON.stringify(x)); S.inspPaste = false; S.inspPasteMsg = null; if (S.route !== 'inspect') go('inspect'); else render(); setTimeout(function () { var ie = $('insp-edit'); if (ie) ie.scrollIntoView({ block: 'start' }); }, 30); }
    else if (act === 'ir-add') { S.inspEdit.rows.push(blankRow()); render(); }
    else if (act === 'ir-del') { S.inspEdit.rows.splice(+el.getAttribute('data-i'), 1); render(); }
    else if (act === 'save-insp') { saveInsp(); S.inspPasteMsg = null; render(); toast('공정점검을 저장했습니다'); }
    else if (act === 'close-insp') { S.inspEdit = null; S.inspPasteMsg = null; render(); }
    else if (act === 'del-insp') { if (!confirm('이 공정점검을 지웁니다.')) return; S.db.inspections = S.db.inspections.filter(function (y) { return y.id !== S.inspEdit.id; }); S.inspEdit = null; save(); render(); }
    else if (act === 'insp-mail') { saveInsp(); S.mail = { vendorId: S.inspEdit.vendorId, inspId: S.inspEdit.id, type: 'internal', draft: null }; go('mail'); }
    else if (act === 'insp-findings') {
      saveInsp();
      var xi = S.inspEdit, made = 0;
      xi.rows.forEach(function (r, ri) {
        if (QA.blank(r.problem)) return;
        var exists = S.db.findings.some(function (f) { return f.inspectionId === xi.id && f.rowNo === ri + 1; });
        if (exists) return;
        newFinding({ inspectionId: xi.id, rowNo: ri + 1, kind: '', date: xi.date, type: '공정', process: r.process, evaluator: mname(xi.inspectorId), finding: r.problem + (QA.blank(r.request) ? '' : ' → 요청: ' + r.request), dueDate: r.due || '', beforePhotos: JSON.parse(JSON.stringify(r.problemPhotos || [])) });
        made++;
      });
      S.findEdit = null; toast(made ? '문제점 ' + made + '건을 지적사항으로 등록했습니다' : '새로 등록할 문제점이 없습니다(이미 등록됨)'); render();
    } else if (act === 'mail-type') { S.mail.type = el.getAttribute('data-t'); S.mail.draft = null; render(); }
    else if (act === 'mail-regen') { S.mail.draft = null; render(); }
    else if (act === 'mail-copy') {
      var dd = S.mail.draft, text = dd.subject + '\n\n' + dd.body;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('복사했습니다'); }, function () { $('mail-body').select(); document.execCommand('copy'); toast('본문을 복사했습니다'); });
    } else if (act === 'mail-open') { var dm = S.mail.draft; dm.to = $('mail-to').value; el.href = QA.mailto(dm.to, dm.subject, dm.body); }
    else if (act === 'mail-save') { var ds = S.mail.draft; S.db.mails.push({ id: QA.uid('mail'), vendorId: S.mail.vendorId, inspectionId: S.mail.inspId, type: ds.type, subject: ds.subject, body: ds.body, to: $('mail-to').value, created: S.today }); save(); render(); toast('메일 이력에 저장했습니다'); }
    else if (act === 'mail-load') { var ml = S.db.mails.filter(function (y) { return y.id === id; })[0]; S.mail.type = ml.type; S.mail.inspId = ml.inspectionId; S.mail.draft = { type: ml.type, subject: ml.subject, body: ml.body, to: ml.to || '', missing: [] }; render(); }
    else if (act === 'mail-ai') aiPolish();
    else if (act === 'ai-use') { S.mail.draft.body = S.mail.ai; render(); }
    else if (act === 'mgr-add') { var nm = $('new-mgr').value.trim(); if (!nm) return; S.db.managers.push({ id: QA.uid('m'), name: nm, email: '' }); save(); renderSel(); render(); }
    else if (act === 'mgr-del') { S.db.managers = S.db.managers.filter(function (m) { return m.id !== id; }); save(); setSel('', ''); }
    else if (act === 'ven-add') { var vn = $('new-ven-name').value.trim(); if (!vn) { toast('업체명을 넣으세요'); return; } S.db.vendors.push({ id: QA.uid('v'), code: $('new-ven-code').value.trim(), name: vn, managerId: $('new-ven-mgr').value, part: '', email: '' }); save(); renderSel(); render(); }
    else if (act === 'ven-del') { S.db.vendors = S.db.vendors.filter(function (v) { return v.id !== id; }); save(); setSel(S.sel.managerId, ''); }
    else if (act === 'export') exportXlsx();
    else if (act === 'backup') download('협력업체품질_백업_' + S.today + '.json', new Blob([QA.backup(S.db, photoList(), S.today)], { type: 'application/json' }));
    else if (act === 'fp-save') {
      var d = S.formDraft, form = QA.makeForm(d.kind, d.result, { name: $('fp-name').value.trim() || d.file, source: d.file + ' (올린 양식)', created: S.today });
      S.db.forms.push(form); S.db.activeForms[d.kind] = form.id; S.formDraft = null; save(); render(); toast(K[d.kind].name + ' 양식을 바꿨습니다 — 새 Audit 부터 이 양식을 씁니다');
    } else if (act === 'fp-cancel') { S.formDraft = null; render(); }
    else if (act === 'paste-open') { var pk = el.getAttribute('data-kind'); S.pasteKind = pk; if (S.formDraft && S.formDraft.kind !== pk) S.formDraft = null; render(); var pt = $('paste-text'); if (pt) { pt.scrollIntoView({ block: 'center' }); pt.focus(); } }
    else if (act === 'paste-close') { S.pasteKind = null; render(); }
    else if (act === 'paste-read') {
      var kd = el.getAttribute('data-kind'), txt = $('paste-text').value, part = $('paste-part') ? $('paste-part').value : null;
      if (!txt.trim()) { toast('붙여 넣은 내용이 없습니다 — 엑셀에서 범위를 복사(Ctrl+C)한 뒤 칸에 붙여 넣으세요'); return; }
      S.pastePart = part;
      var prev = S.formDraft && S.formDraft.pasted && S.formDraft.kind === kd ? S.formDraft : null;
      var bk = QA.pasteBook(kd, txt, prev, part);
      S.formDraft = { kind: kd, file: '붙여넣기(' + K[kd].short + ')', names: bk.names, sheets: bk.sheets, opts: kd === 'B' ? {} : { sheet: bk.sheet }, pasted: true };
      reparseDraft(); render(); toast(bk.rows + '줄 · ' + bk.cols + '열을 읽었습니다');
      var fp2 = $('form-preview'); if (fp2) fp2.scrollIntoView({ block: 'start' });
    }
    else if (act === 'copy-sheet' || act === 'csv-sheet') {
      var rp = QA.reportSheets(S.db, scope().vendorIds, S.today), sc2 = scope(), tg = (sc2.mode === 'vendor' ? sc2.vendor.name : sc2.mode === 'manager' ? mname(sc2.managerId) : '전체').replace(/[\\/:*?"<>|()\s]/g, '');
      if (act === 'copy-sheet') {
        var shn = el.getAttribute('data-sheet'), tsv = QA.toTSV(rp.sheets[shn]);
        S.lastCopy = tsv;
        copyText(tsv, function (okc) { toast(okc ? shn + ' 표(' + (rp.sheets[shn].length - 1) + '행)를 복사했습니다 — 엑셀 A1 칸에 붙여 넣으세요' : '복사하지 못했습니다 — 이 브라우저가 클립보드를 막았습니다'); });
      } else rp.names.forEach(function (nm, i) { setTimeout(function () { download('협력업체품질_' + tg + '_' + S.today + '_' + nm + '.csv', new Blob([QA.toCSV(rp.sheets[nm])], { type: 'text/csv;charset=utf-8' })); }, i * 300); });
    }
    else if (act === 'restore-paste-open') { S.restorePaste = !S.restorePaste; render(); }
    else if (act === 'restore-paste') { restoreFrom($('restore-text').value); }
    else if (act === 'insp-paste-open') { S.inspPaste = !S.inspPaste; render(); var it2 = $('insp-paste-text'); if (it2) it2.focus(); }
    else if (act === 'insp-paste-read') {
      var itxt = $('insp-paste-text').value;
      if (!itxt.trim()) { toast('붙여 넣은 내용이 없습니다'); return; }
      var pr = QA.parseInspectRows(QA.parsePaste(itxt).aoa, { year: (S.inspEdit.date || S.today).slice(0, 4) });
      if (!pr.ok) { S.inspPasteMsg = [pr.error].concat(pr.warnings); render(); return; }
      var ex = S.inspEdit.rows.filter(function (r) { return r.process || r.item || r.check || r.problem || r.request || r.owner || r.due || (r.problemPhotos || []).length || (r.fixPhotos || []).length; });
      S.inspEdit.rows = ex.concat(pr.rows); S.inspPaste = false; S.inspPasteMsg = ['점검 행 ' + pr.rows.length + '개를 넣었습니다(빈 행은 정리했습니다). 저장하려면 「점검 결과 저장」을 누르세요.'].concat(pr.warnings);
      render();
    }
  }
  function onInput(e) {
    var el = e.target, act = el.getAttribute('data-act'); if (!act) return;
    var k = el.getAttribute('data-k'), val = el.value;
    if (act === 'ed-head') { S.edit.audit[k] = k === 'round' ? (+val || '') : val; if (k === 'date') renderAuditSummary(); }
    else if (act === 'ed-note') { S.edit.audit.notes = S.edit.audit.notes || {}; S.edit.audit.notes[el.getAttribute('data-no')] = val; }
    else if (act === 'ed-prod') S.edit.audit.product[k] = val;
    else if (act === 'ed-issue') { var is = S.edit.audit.issues[+el.getAttribute('data-i')]; is[k] = k === 'status' ? +val : val; }
    else if (act === 'fe') {
      S.findEdit[k] = val;
      var st = $('fe-status'); if (st) st.innerHTML = stTag(QA.findingStatus(S.findEdit)) + (QA.isOverdue(S.findEdit, S.today) ? ' <span class="tag bad">기한 초과</span>' : '');
    }
    else if (act === 'ph-cap') photoTarget(el)[+el.getAttribute('data-j')].caption = val;
    else if (act === 'ir') S.inspEdit.rows[+el.getAttribute('data-i')][k] = val;
    else if (act === 'ih') S.inspEdit[k] = val;
    else if (act === 'mail-edit') S.mail.draft[k] = val;
    else if (act === 'mgr-edit') { var m = manager(el.getAttribute('data-id')); m[k] = val; save(); }
    else if (act === 'ven-edit' && el.tagName !== 'SELECT') { var v = vendor(el.getAttribute('data-id')); v[k] = val; save(); }
    else if (act === 'ai-cfg') { try { localStorage.setItem('qa14.ai', JSON.stringify({ provider: $('ai-provider').value, key: $('ai-key').value.trim() })); } catch (x) { /* 저장 못 해도 */ } }
  }
  function onChange(e) {
    var el = e.target, act = el.getAttribute('data-act'); if (!act) return;
    var val = el.value;
    if (act === 'ed-val') {
      var no = el.getAttribute('data-no');
      if (val === '') delete S.edit.audit.values[no];
      else S.edit.audit.values[no] = S.edit.kind === 'B' || val === 'N/A' ? val : Number(val);
      renderAuditSummary();
    } else if (act === 'ed-stage') { S.edit.audit.stage = val; S.edit.audit.values = {}; render(); }
    else if (act === 'ed-detail') { var d = S.edit.audit.detail[el.getAttribute('data-no')] = S.edit.audit.detail[el.getAttribute('data-no')] || { res: '', apply: '해당' }; d[el.getAttribute('data-k')] = val; renderAuditSummary(); }
    else if (act === 'ed-issue') onInput(e);
    else if (act === 'fe' && el.tagName === 'SELECT') onInput(e);
    else if (act === 'ir' && el.tagName === 'SELECT') onInput(e);
    else if (act === 'ih' && el.tagName === 'SELECT') onInput(e);
    else if (act === 'ven-edit' && el.tagName === 'SELECT') { vendor(el.getAttribute('data-id')).managerId = val; save(); setSel(S.sel.managerId, S.sel.vendorId); }
    else if (act === 'f-filter') { S.findFilter = S.findFilter || { status: '', kind: '' }; S.findFilter[el.getAttribute('data-k')] = val; render(); }
    else if (act === 'mail-insp') { S.mail.inspId = val; S.mail.draft = null; render(); }
    else if (act === 'ph-add') { var files = el.files, tgt = photoTarget(el); addPhotos(files).then(function (ps) { ps.forEach(function (p) { tgt.push(p); }); render(); toast('사진 ' + ps.length + '장을 붙였습니다'); }); }
    else if (act === 'form-active') { S.db.activeForms[el.getAttribute('data-kind')] = val; save(); render(); }
    else if (act === 'form-file') {
      var file = el.files[0], kind = el.getAttribute('data-kind'); if (!file) return;
      readXlsx(file).then(function (b) { S.formDraft = { kind: kind, file: file.name, names: b.names, sheets: b.sheets, opts: {} }; reparseDraft(); render(); var fp = $('form-preview'); if (fp) fp.scrollIntoView({ block: 'start' }); })
        .catch(function (x) { toast('엑셀을 읽지 못했습니다: ' + x.message); });
    } else if (act === 'fp-sheet') { S.formDraft.opts = { sheet: val }; reparseDraft(); render(); }
    else if (act === 'fp-hrow' || act === 'fp-map') {
      var dr = S.formDraft, r = dr.result, map = JSON.parse(JSON.stringify(r.map || {}));
      if (act === 'fp-map') { if (val === '') delete map[el.getAttribute('data-f')]; else map[el.getAttribute('data-f')] = +val; }
      var hr = act === 'fp-hrow' ? Math.max(0, (+val || 1) - 1) : r.headerRow;
      if (act === 'fp-hrow') map = QA.matchHeader((dr.sheets[r.sheet] || [])[hr], QA.FIELDS[dr.kind]);
      dr.opts = { sheet: r.sheet, headerRow: hr, map: map };
      reparseDraft();
      if (!dr.result.header) { dr.result.header = ((dr.sheets[r.sheet] || [])[hr] || []).map(String); dr.result.map = map; dr.result.headerRow = hr; dr.result.sheet = r.sheet; }
      render();
    } else if (act === 'restore') {
      var rf = el.files[0]; if (!rf) return;
      rf.text().then(restoreFrom);
    } else if (act === 'ai-cfg') onInput(e);
  }

  /* ---------- 시작 ---------- */
  $('view').addEventListener('click', onClick);
  $('view').addEventListener('input', onInput);
  $('view').addEventListener('change', onChange);
  $('sel-manager').addEventListener('change', function () { setSel(this.value, ''); });
  $('sel-vendor').addEventListener('change', function () { setSel(S.sel.managerId, this.value); });
  $('sel-clear').addEventListener('click', function () { setSel('', ''); });
  window.addEventListener('hashchange', route);
  try { var sv = JSON.parse(localStorage.getItem('qa14.sel') || 'null'); if (sv) S.sel = { managerId: sv.managerId || '', vendorId: sv.vendorId || '' }; } catch (e) { /* 처음 */ }
  openDb().then(loadAll).catch(function () { /* 저장소 없이도 화면은 돈다 */ }).then(function () {
    if (S.sel.managerId && !manager(S.sel.managerId)) S.sel = { managerId: '', vendorId: '' };
    if (S.sel.vendorId && !vendor(S.sel.vendorId)) S.sel.vendorId = '';
    $('saved').textContent = idb ? '이 브라우저(IndexedDB)에 저장됩니다' : '이 브라우저는 IndexedDB 를 쓸 수 없어 저장되지 않습니다';
    renderSel(); route();
    document.body.setAttribute('data-ready', '1');
  });
})();
