/* 브라우저에 실제로 띄워 화면이 그려지는지 본다 — node test/smoke.browser.js
 * 규칙 테스트가 다 통과해도 app.js 오타 하나면 빈 화면이 된다. playwright 가 없으면 건너뛴다. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다.'); process.exit(0); }
var XLSX = require('../lib/xlsx.full.min.js');
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
  await br.close(); srv.close();
  console.log('\n화면 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed ? 1 : 0);
});
