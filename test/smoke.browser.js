/* 브라우저에 실제로 띄워 화면이 그려지는지 본다 — node test/smoke.browser.js
 * 규칙 테스트가 다 통과해도 app.js 오타 하나면 빈 화면이 된다. playwright 가 없으면 건너뛴다. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다.'); process.exit(0); }
var XLSX = require('../lib/xlsx.full.min.js');
var QA = require('../js/audit.js');
var ROOT = path.join(__dirname, '..');
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.xlsx': 'application/octet-stream' };
var srv = http.createServer(function (q, s) {
  var p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, function (e, b) { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
});
var passed = 0, failed = 0;
function ok(c, label, d) { if (c) passed++; else { failed++; console.log('  X ' + label + (d !== undefined ? '  ' + d : '')); } }
var count = function (pg, sel) { return pg.$$eval(sel, function (t) { return t.length; }); };
var text = function (pg, sel) { return pg.textContent(sel); };
// 2×2 빨간 PNG
var PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAxMDAAAAMBQEB3gq4dwAAAABJRU5ErkJggg==', 'base64');
srv.listen(0, async function () {
  var base = 'http://127.0.0.1:' + srv.address().port + '/';
  var br = await chromium.launch(); var ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.replace(/\/$/, '') });
  var pg = await ctx.newPage();
  var errs = []; pg.on('pageerror', function (e) { errs.push(e.message); });
  pg.on('dialog', function (d) { d.accept(); });
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa14-smoke-'));
  try {
    await pg.goto(base);
    await pg.waitForSelector('body[data-ready="1"]');
    ok(/예제로 해보기/.test(await text(pg, '#view')), '처음 열면 대시보드(빈 상태 안내)');
    await pg.click('#btn-sample');
    await pg.waitForSelector('#kpi');
    ok(await count(pg, '#kpi .stat') === 6, '대시보드 KPI 6개');
    ok(/관리 업체 수/.test(await text(pg, '#kpi')) && /4곳/.test(await text(pg, '#kpi')), '전체 현황: 업체 4곳');
    ok(await count(pg, '#vendor-table tbody tr') === 4, '업체별 상세 현황 4행');
    ok(await count(pg, '#dash-chart svg rect') >= 8, '업체별 점수 비교 그래프');
    ok(/예제 데이터는 실제 사내 데이터가 아닙니다/.test(await text(pg, '#view')), '예제 표기');
    // 담당자 선택 → 담당 업체 전체
    await pg.selectOption('#sel-manager', 'm1');
    await pg.waitForFunction(function () { return /담당자 현황/.test(document.getElementById('sel-mode').textContent); });
    ok(await count(pg, '#vendor-table tbody tr') === 2, '담당자 선택 → 그 담당자의 업체 2곳');
    // 업체 선택 → 상세
    await pg.selectOption('#sel-vendor', 'v1');
    await pg.waitForSelector('#kind-table');
    ok(/업체 상세/.test(await text(pg, '#sel-mode')), '업체 선택 → 업체 상세 현황');
    ok(await count(pg, '#dash-chart polyline') >= 2, '업체 상세: Audit 점수 변화 그래프(종류별 선)');
    ok(await count(pg, '#dash-open tbody tr') > 0 && /기한 초과/.test(await text(pg, '#dash-open')), '업체 상세: 미완료 개선사항 · 기한 초과');
    // 다른 메뉴로 가도 선택 유지
    await pg.click('#side a[data-r="audit/A"]');
    await pg.waitForSelector('#audit-hist');
    ok(await pg.inputValue('#sel-vendor') === 'v1' && await pg.inputValue('#sel-manager') === 'm1', '메뉴를 옮겨도 담당자·업체 선택 유지');
    ok(await count(pg, '#audit-hist tbody tr') === 3, '대형 제관 Audit 이력 3회');
    await pg.click('#side a[data-r="findings"]'); await pg.waitForSelector('#find-table');
    await pg.click('#side a[data-r="audit/A"]'); await pg.waitForSelector('#audit-hist');
    ok(await pg.inputValue('#sel-vendor') === 'v1', '두 번 옮겨도 선택 유지');
    // 새 Audit 입력 → 총점·판정
    await pg.click('#btn-new-audit');
    await pg.waitForSelector('#ed-table');
    var n = await count(pg, '#ed-table select.ed-v');
    ok(n === 14, '예제 양식 14항목 입력 칸', n);
    for (var i = 1; i <= n; i++) await pg.selectOption('#ed-table select.ed-v[data-no="' + i + '"]', '3');
    ok((await text(pg, '#ed-total')).trim() === '100.0' && /양호/.test(await text(pg, '#ed-judge')), '모두 Level 3 → 100.0 · 양호');
    await pg.selectOption('#ed-table select.ed-v[data-no="1"]', '0');   // CTQ: −6
    await pg.selectOption('#ed-table select.ed-v[data-no="6"]', '1');   // CTQ: −4
    ok((await text(pg, '#ed-total')).trim() === '83.3' && /개선요/.test(await text(pg, '#ed-judge')), 'CTQ 2항목 낮추면 50/60 = 83.3 · 개선요', await text(pg, '#ed-total'));
    ok(/0/.test(await text(pg, '#cv-1')) && (await text(pg, '#cv-2')).trim() === '3', '항목별 환산 칸 갱신');
    ok(await count(pg, '#ed-cmp-stats .stat') === 3, '이전 Audit 대비 비교');
    await pg.click('#btn-save-audit');
    await pg.waitForFunction(function () { return document.querySelectorAll('#audit-hist tbody tr').length === 4; });
    ok(true, '저장하면 이력 4회');
    // 지적 등록 → 개선조치
    await pg.click('#ed-table button[data-no="1"]');
    await pg.waitForSelector('#find-edit');
    ok(/계획 미수립/.test(await text(pg, '#fe-status')), '새 지적은 「계획 미수립」');
    ok(/재발/.test(await text(pg, '#find-edit')), '재발 자동 판정 표시');
    await pg.fill('#find-edit input[data-k="planDate"]', '2026-10-01');
    await pg.waitForFunction(function () { return /기한 초과/.test(document.getElementById('fe-status').textContent); });
    ok(/개선 진행중/.test(await text(pg, '#fe-status')), '계획일정을 넣으면 「개선 진행중」 + 지났으면 기한 초과');
    await pg.click('#btn-save-finding');
    await pg.waitForSelector('#find-table');
    ok(/기한 초과/.test(await text(pg, '#find-table')), '지적사항 표에 기한 초과 표시');
    await pg.selectOption('#f-status', '기한 초과');
    var od = await count(pg, '#find-table tbody tr');
    ok(od > 0 && (await pg.$$eval('#find-table tbody tr', function (t) { return t.every(function (r) { return /기한 초과/.test(r.textContent); }); })), '「기한 초과」 거르기', od);
    ok(await count(pg, '#repeat tbody tr') > 0, '반복 지적사항 분석');
    // 점수 분석
    await pg.click('#side a[data-r="analysis"]'); await pg.waitForSelector('#an-line');
    ok(await count(pg, '#an-line polyline') >= 2 && await count(pg, '#improve tbody tr') >= 2, '업체 점수 변화 · 개선 효과');
    // 새로 열어도 저장 · 선택이 남는다(IndexedDB · localStorage)
    await pg.reload(); await pg.waitForSelector('body[data-ready="1"]');
    await pg.click('#side a[data-r="audit/A"]'); await pg.waitForSelector('#audit-hist');
    ok(await pg.inputValue('#sel-vendor') === 'v1' && await count(pg, '#audit-hist tbody tr') === 4, '새로 고침 뒤에도 선택과 저장한 Audit 가 남는다');
    // 공정점검: 가로형 표 · 사진 첨부
    await pg.click('#side a[data-r="inspect"]'); await pg.waitForSelector('#insp-list');
    await pg.click('#insp-list button[data-act="open-insp"]'); await pg.waitForSelector('#insp-table');
    ok(await count(pg, '#insp-table thead th') === 12 && /문제점 사진/.test(await text(pg, '#insp-table thead')), '가로형 표 머리(문제점 · 사진 · 개선 요청 · 개선 사진 …)');
    ok(await count(pg, '#insp-table tbody tr:nth-child(2) .ph img') === 3, '예제 사진 미리보기(문제점 2 · 개선 1)');
    await pg.setInputFiles('#insp-table tbody tr:nth-child(3) input[data-f="problemPhotos"]', [{ name: '균열.png', mimeType: 'image/png', buffer: PNG }, { name: '균열2.png', mimeType: 'image/png', buffer: PNG }]);
    await pg.waitForFunction(function () { return document.querySelectorAll('#insp-table tbody tr:nth-child(3) .ph img').length === 2; });
    ok(true, '사진 여러 장 첨부 · 미리보기');
    await pg.fill('#insp-table tbody tr:nth-child(3) textarea[data-k="problem"]', '검사 기록지 서명 누락');
    await pg.fill('#insp-table tbody tr:nth-child(3) textarea[data-k="request"]', '서명란을 채워 주세요');
    await pg.click('#btn-add-row');
    ok(await count(pg, '#insp-table tbody tr') === 4, '행 추가');
    // 엑셀에서 복사해 붙여넣기(DRM 노트북) — 머리글 · 날짜 · 상태를 읽어 빈 행은 정리하고 덧붙인다
    await pg.click('#btn-insp-paste'); await pg.waitForSelector('#insp-paste-text');
    await pg.fill('#insp-paste-text', ['No.\t점검 공정\t점검 항목\t확인 내용\t문제점\t개선 요청사항\t담당자\t완료 예정일\t진행상태', '1\t절단\t치수\t측정\t길이 초과\t재측정\t업체 품질\t2026. 12. 5.\t조치중', '2\t도장\t두께\t측정\t\t\t\t12/9\t완료'].join('\n'));
    await pg.click('#btn-insp-paste-read'); await pg.waitForSelector('#insp-paste-msg');
    ok(await count(pg, '#insp-table tbody tr') === 5 && /2개를 넣었습니다/.test(await text(pg, '#insp-paste-msg')), '공정점검 붙여넣기: 빈 행 정리 + 2행 추가', await count(pg, '#insp-table tbody tr'));
    ok(await pg.inputValue('#insp-table tbody tr:nth-child(4) input[data-k="due"]') === '2026-12-05' && await pg.inputValue('#insp-table tbody tr:nth-child(4) select[data-k="state"]') === '조치 중', '공정점검 붙여넣기: 「2026. 12. 5.」 → 날짜 칸 · 「조치중」 → 조치 중');
    ok(/^\d{4}-12-09$/.test(await pg.inputValue('#insp-table tbody tr:nth-child(5) input[data-k="due"]')), '공정점검 붙여넣기: 연도 없는 12/9 는 점검 연도로');
    await pg.click('#btn-save-insp');
    // 메일 2종
    await pg.click('#btn-to-mail'); await pg.waitForSelector('#mail-body');
    var body = await pg.inputValue('#mail-body');
    ok(/1\. 점검 개요/.test(body) && /6\. 종합 의견/.test(body) && /서명 누락/.test(body), '내부 보고 메일 초안(방금 넣은 문제점 포함)');
    ok(/문제점 2장/.test(body), '메일에 사진 장수');
    ok(/A정밀/.test(await pg.inputValue('#mail-subject')), '메일 제목에 업체명');
    await pg.click('#mail-vendor');
    await pg.waitForFunction(function () { return /회신/.test(document.getElementById('mail-body').value); });
    ok(/품질 담당자님께/.test(await pg.inputValue('#mail-body')), '업체 발송 메일로 전환');
    ok(/^mailto:/.test(await pg.getAttribute('#btn-mailto', 'href')), 'mailto 링크');
    await pg.click('#btn-save-mail');
    await pg.waitForSelector('#mail-hist tbody tr');
    ok(await count(pg, '#mail-hist tbody tr') === 1, '메일 이력 저장');
    // 양식 엑셀 읽기
    await pg.click('#side a[data-r="data"]'); await pg.waitForSelector('#form-table');
    await pg.setInputFiles('#form-file-D', path.join(ROOT, 'samples', 'form-D-paint-audit.xlsx'));
    await pg.waitForSelector('#fp-ok');
    ok(/항목 10개/.test(await text(pg, '#fp-ok')) && /만점 22/.test(await text(pg, '#fp-ok')), '도장 양식 엑셀 → 항목 10개 · 만점 22');
    await pg.click('#btn-form-save');
    await pg.waitForFunction(function () { return /올린 양식/.test(document.getElementById('form-table').textContent); });
    ok(true, '올린 양식을 저장하고 쓰는 양식으로');
    // 엑셀 파일을 고를 수 없을 때 — 범위를 복사해 붙여넣기(파일과 같은 읽기)
    var bookA = QA.sampleFormBook('A'), shA = QA.parseFormBook('A', bookA.sheets, bookA.names).sheet;
    await pg.click('#btn-paste-A'); await pg.waitForSelector('#paste-text');
    await pg.fill('#paste-text', QA.toTSV(bookA.sheets[shA]));
    await pg.click('#btn-paste-read'); await pg.waitForSelector('#fp-ok');
    ok(/항목 14개/.test(await text(pg, '#fp-ok')) && /만점 60/.test(await text(pg, '#fp-ok')), '대형 제관 양식 붙여넣기 → 항목 14개 · 만점 60(파일과 같음)', await text(pg, '#fp-ok'));
    ok(await pg.$eval('#form-preview select[data-act="fp-map"][data-f="weight"]', function (e) { return e.value !== ''; }), '붙여넣은 표도 열 직접 고르기 화면이 뜬다');
    await pg.click('#form-preview button[data-act="fp-cancel"]');
    var bookB = QA.sampleFormBook('B');
    await pg.click('#btn-paste-B'); await pg.waitForSelector('#paste-part');
    for (var part of [['preBasic', 'Pre-PSO(기본)'], ['preDetail', 'Pre-PSO(상세)'], ['psoBasic', 'PSO(기본)']]) {
      await pg.selectOption('#paste-part', part[0]); await pg.fill('#paste-text', QA.toTSV(bookB.sheets[part[1]])); await pg.click('#btn-paste-read'); await pg.waitForSelector('#fp-ok');
    }
    var fb = QA.parseFormBook('B', bookB.sheets, bookB.names), nB = fb.preBasic.length + fb.preDetail.length + fb.psoBasic.length;
    ok(new RegExp('항목 ' + nB + '개').test(await text(pg, '#fp-ok')) && !/시트가 없습니다/.test(await text(pg, '#form-preview')), 'PSO 붙여넣기 3부분 → 파일과 같은 ' + nB + '항목', await text(pg, '#form-preview'));
    await pg.click('#form-preview button[data-act="fp-cancel"]');
    await pg.setInputFiles('#form-file-D', { name: '도장양식.csv', mimeType: 'text/csv', buffer: Buffer.from(QA.toCSV(QA.sampleFormBook('D').sheets[QA.sampleFormBook('D').names[0]]), 'utf8') });
    await pg.waitForSelector('#fp-ok');
    ok(/항목 10개/.test(await text(pg, '#fp-ok')) && /만점 22/.test(await text(pg, '#fp-ok')), 'CSV 파일도 고를 수 있다 → 항목 10개 · 만점 22');
    await pg.click('#form-preview button[data-act="fp-cancel"]');
    // 결과 표 복사(엑셀 파일을 못 열 때)
    await pg.click('#copy-tables button[data-sheet="Audit결과"]');
    await pg.waitForFunction(function () { return /복사했습니다/.test(document.body.textContent); });
    var clip = await pg.evaluate(function () { return navigator.clipboard.readText(); });
    var ca = QA.parsePaste(clip).aoa;
    ok(QA.parsePaste(clip).delim === 'tab' && ca[0].length === 13 && ca[0][0] === '업체' && ca.length - 1 === 7 && /A정밀/.test(ca[1][0]), 'Audit결과 표 복사 → 엑셀에 붙일 탭 글자(선택 업체 7행)', ca.length);
    var dcsv = await Promise.all([pg.waitForEvent('download'), pg.click('#btn-csv')]);
    ok(/Audit결과\.csv$/.test(dcsv[0].suggestedFilename()), 'CSV 로 받기', dcsv[0].suggestedFilename());
    // 오프라인 사용 파일 받기
    var dof = await Promise.all([pg.waitForEvent('download'), pg.click('#btn-offline')]);
    var of = path.join(tmp, 'off.html'); await dof[0].saveAs(of);
    ok(fs.readFileSync(of, 'utf8') === fs.readFileSync(path.join(ROOT, 'offline', 'qa-2611-14-offline.html'), 'utf8') && /오프라인/.test(dof[0].suggestedFilename()), '「오프라인 사용 파일 받기」 → HTML 하나', dof[0].suggestedFilename());
    // 엑셀 · 백업
    var dx = await Promise.all([pg.waitForEvent('download'), pg.click('#btn-export')]);
    var xf = path.join(tmp, 'out.xlsx'); await dx[0].saveAs(xf);
    var wb = XLSX.read(fs.readFileSync(xf), { type: 'buffer' });
    ok(wb.SheetNames.join() === 'Audit결과,항목별점수,지적사항,공정점검,메일이력', '엑셀 5시트', wb.SheetNames.join());
    var rows = XLSX.utils.sheet_to_json(wb.Sheets['Audit결과'], { header: 1 });
    ok(rows.length - 1 === 7, '엑셀은 선택한 업체(A정밀) Audit 만 — 6 + 새로 넣은 1', rows.length - 1);
    var db2 = await Promise.all([pg.waitForEvent('download'), pg.click('#btn-backup')]);
    var bf = path.join(tmp, 'b.json'); await db2[0].saveAs(bf);
    ok(/"schema":"qa-2611-14"/.test(fs.readFileSync(bf, 'utf8')), '전체 백업 JSON');
    // 선택 해제 → 업체가 필요한 메뉴는 안내
    await pg.click('#sel-clear');
    await pg.click('#side a[data-r="inspect"]');
    await pg.waitForFunction(function () { return location.hash === '#/inspect' && !document.getElementById('form-table'); });   // hashchange 는 다음 차례에 돈다
    ok(/업체를 먼저 고르세요/.test(await text(pg, '#view')), '업체 없이 공정점검을 열면 위에서 고르라고 안내');
    // 좁은 화면
    await pg.setViewportSize({ width: 360, height: 800 });
    var over = [];
    for (var r of ['dashboard', 'audit/A', 'findings', 'inspect', 'mail', 'data']) {
      await pg.goto(base + '#/' + r); await pg.waitForSelector('body[data-ready="1"]');
      if (r === 'dashboard') { await pg.selectOption('#sel-manager', 'm1'); await pg.selectOption('#sel-vendor', 'v1'); await pg.waitForSelector('#kind-table'); }
      if (r === 'audit/A') { await pg.click('#btn-new-audit'); await pg.waitForSelector('#ed-table'); }
      if (r === 'inspect') { await pg.click('#insp-list button[data-act="open-insp"]'); await pg.waitForSelector('#insp-table'); }
      var o = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
      if (o > 0) over.push(r + ' ' + o);
    }
    ok(!over.length, '360px 에서 가로 넘침 없음(표는 상자 안에서 가로 스크롤)', over.join(', '));
    await pg.setViewportSize({ width: 1280, height: 900 });
    await pg.goto(base + 'guide.html');
    ok(/Level/.test(await text(pg, 'main')) && /서버/.test(await text(pg, 'main')), '사용법 페이지');
  } catch (e) { failed++; console.log('  X 예외: ' + e.message); }
  ok(!errs.length, '페이지 오류 없음', errs.join(' | '));
  // 폐쇄망: 인터넷을 끊은 브라우저에서 오프라인 파일을 file:// 로 연다. 바깥 요청이 하나라도 나가면 실패.
  try {
    var octx = await br.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, offline: true });
    var reqs = [], oerrs = [];
    await octx.route('**/*', function (r) { var u = r.request().url(); if (/^(file|data|blob):/.test(u)) return r.continue(); reqs.push(u); return r.abort(); });
    var op = await octx.newPage();
    op.on('request', function (q) { if (!/^(file|data|blob):/.test(q.url())) reqs.push(q.url()); });
    op.on('pageerror', function (e) { oerrs.push(e.message); }); op.on('dialog', function (d) { d.accept(); });
    await op.goto('file://' + path.join(ROOT, 'offline', 'qa-2611-14-offline.html'));
    await op.waitForSelector('body[data-ready="1"]');
    ok(/오프라인 파일 v/.test(await op.textContent('.eyebrow')), '오프라인 파일: file:// 로 열린다(인터넷 끊김)');
    await op.click('#btn-sample'); await op.waitForSelector('#kpi');
    ok(await op.$$eval('#kpi .stat', function (t) { return t.length; }) === 6, '오프라인 파일: 예제 → 대시보드 KPI 6개');
    await op.goto('file://' + path.join(ROOT, 'offline', 'qa-2611-14-offline.html') + '#/data'); await op.waitForSelector('#form-table');
    ok(/오프라인 파일로 쓰는 중/.test(await op.textContent('#offline-card')) && await op.$$eval('#btn-offline', function (t) { return t.length; }) === 0, '오프라인 파일: 「받기」 대신 오프라인 안내');
    ok(/4곳/.test(await op.textContent('#view')), '오프라인 파일: 다시 열어도 자료가 남는다(브라우저 저장소)');
    await op.click('#btn-paste-D'); await op.fill('#paste-text', QA.toTSV(QA.sampleFormBook('D').sheets[QA.sampleFormBook('D').names[0]])); await op.click('#btn-paste-read'); await op.waitForSelector('#fp-ok');
    ok(/항목 10개/.test(await op.textContent('#fp-ok')), '오프라인 파일: 양식 붙여넣기');
    await op.setInputFiles('#form-file-C', path.join(ROOT, 'samples', 'form-C-process-audit.xlsx')); await op.waitForSelector('#fp-ok');
    ok(/항목 12개/.test(await op.textContent('#fp-ok')), '오프라인 파일: 엑셀 파일 읽기(SheetJS 동봉)', await op.textContent('#fp-ok'));
    var ox = await Promise.all([op.waitForEvent('download'), op.click('#btn-export')]);
    var oxf = path.join(tmp, 'off.xlsx'); await ox[0].saveAs(oxf);
    ok(XLSX.read(fs.readFileSync(oxf), { type: 'buffer' }).SheetNames.length === 5, '오프라인 파일: 엑셀 5시트 내보내기');
    ok(!reqs.length, '오프라인 파일: 바깥 요청 0건', reqs.join(' | '));
    ok(!oerrs.length, '오프라인 파일: 페이지 오류 없음', oerrs.join(' | '));
    await octx.close();
  } catch (e) { failed++; console.log('  X 오프라인 예외: ' + e.message); }
  await br.close(); srv.close();
  console.log('\n화면 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed ? 1 : 0);
});
