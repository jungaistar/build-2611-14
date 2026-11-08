/* 판정·계산 규칙 고정 — node test/logic.test.js
 * 점수식은 회사 양식의 엑셀 식을 옮긴 것이다. 손으로 셀 수 있는 작은 양식으로 대조하고,
 * 판정 경계값 · N/A · 0 나누기 · 양식 읽기 · 상태 · 기한 초과 · 재발 · 이력 비교를 고정한다. */
'use strict';
var QA = require('../js/audit.js');
var XLSX = require('../lib/xlsx.full.min.js');
var fs = require('fs'), path = require('path');
var passed = 0, failed = 0;
function ok(c, label, detail) { if (c) passed++; else { failed++; console.log('  X ' + label + (detail ? '\n      ' + detail : '')); } }
function eq(g, w, label) { ok(JSON.stringify(g) === JSON.stringify(w), label, '기대: ' + JSON.stringify(w) + '  실제: ' + JSON.stringify(g)); }
function near(g, w, label) { ok(g != null && Math.abs(g - w) < 1e-9, label, '기대: ' + w + '  실제: ' + g); }
var TODAY = '2026-11-03';

/* ---------- A 대형 제관: Level × 가중치 ---------- */
var FA = { kind: 'A', items: [
  { no: '1', ctq: true, process: '용접', weight: 2, content: 'a' },
  { no: '2', ctq: false, process: '용접', weight: 1, content: 'b' },
  { no: '3', ctq: false, process: '검사', weight: 1, content: 'c' }] };
var a1 = QA.scoreA(FA, { 1: 3, 2: 2, 3: 0 });
eq([a1.raw, a1.max], [8, 12], 'A 환산 합 = 3×2+2×1+0×1 = 8, 만점 = (2+1+1)×3 = 12');
near(a1.pct, 8 / 12 * 100, 'A 백분율 = SUM(환산)/(SUM(가중치)×3)×100');
eq(a1.judge, '불합격', 'A 66.7점 → 불합격');
eq(a1.rows.map(function (r) { return r.conv; }), [6, 2, 0], 'A 항목별 환산 = Level × 가중치');
eq(a1.groups.map(function (g) { return [g.name, g.raw, g.max]; }), [['용접', 8, 9], ['검사', 0, 3]], 'A 공정 묶음별 원점수/만점');
eq(QA.scoreA(FA, { 1: 3, 2: 3, 3: 3 }).judge, '양호', 'A 만점 → 양호');
var am = QA.scoreA(FA, { 1: 3 });
eq([am.missing, am.raw], [2, 6], 'A 미입력은 0 으로 더하고 개수를 알린다');
near(am.pct, 50, 'A 미입력 포함 백분율(분모는 전체)');
eq(QA.scoreA(FA, { 1: 4, 2: 1.5 }).invalid, ['1', '2'], 'A Level 은 0~3 정수만');
eq([QA.judgeA(90), QA.judgeA(89.99), QA.judgeA(75), QA.judgeA(74.99), QA.judgeA(null)], ['양호', '개선요', '개선요', '불합격', ''], 'A 판정 경계 90 · 75');
eq(QA.scoreA({ items: [] }, {}).pct, null, 'A 항목이 없으면 0 나누기 없이 null');

/* ---------- C Process Audit: 공정별 10점 + Grade ---------- */
var FC = { kind: 'C', items: [
  { no: '1', process: 'P1', weight: 2, content: 'a' },
  { no: '2', process: 'P1', weight: 1, content: 'b' },
  { no: '3', process: 'P2', weight: 1, content: 'c' },
  { no: '4', process: 'P3', weight: 2, content: 'd' }] };
var c1 = QA.scoreC(FC, { 1: 2, 2: 'N/A', 3: 0, 4: 'N/A' });
var g1 = c1.groups[0], g2 = c1.groups[1], g3 = c1.groups[2];
eq([g1.total, g1.valid, g1.conv, g1.score10, g1.grade], [6, 4, 4, 10, 'Green'], 'C 공정 P1: 총 합계 6 · 유효 6−2×1=4 · 환산 4 · 10점 · Green');
eq([g2.total, g2.valid, g2.conv, g2.score10, g2.grade], [2, 2, 0, 0, 'Red'], 'C 공정 P2: 0점 → Red');
eq([g3.valid, g3.score10, g3.grade], [0, 0, 'N/A'], 'C 유효 합계 0 이면 점수 0 · Grade N/A(0 나누기 없음)');
eq([c1.raw, c1.max], [4, 2 * 6 - 2 * 3], 'C 총점 분모 = 2×SUM(가중치) − 2×SUM(N/A 가중치)');
near(c1.pct, 4 / 6 * 100, 'C 총점 = SUM(환산)/분모×100');
eq(c1.rows[1].conv, null, 'C N/A 항목의 환산은 빈칸');
eq(QA.scoreC(FC, {}).groups.map(function (g) { return g.grade; }), ['', '', ''], 'C 입력이 없으면 Grade 빈칸');
eq(QA.scoreC(FC, { 1: 'N/A', 2: 'n/a', 3: 'NA', 4: 'N/A' }).pct, null, 'C 모두 N/A → 총점 N/A(null)');
eq([QA.gradeC(9, 1, 1), QA.gradeC(8.99, 1, 1), QA.gradeC(7, 1, 1), QA.gradeC(6.99, 1, 1)], ['Green', 'Yellow', 'Yellow', 'Red'], 'C Grade 경계 9 · 7');
eq(QA.scoreC(FC, { 1: 3 }).invalid, ['1'], 'C 점수는 2·1·0·N/A 만');

/* ---------- D 도장: N/A 뺀 평가점수 / N/A 뺀 배점 ---------- */
var FD = { kind: 'D', items: [
  { no: '1', group: 'G1', points: 3, item: 'a', check: '', options: [3, 2, 1, 0] },
  { no: '2', group: 'G1', points: 2, item: 'b', check: '', options: [2, 1, 0] },
  { no: '3', group: 'G2', points: 1, item: 'c', check: '', options: [1, 0] }] };
var d1 = QA.scoreD(FD, { 1: 2, 2: 'N/A', 3: 1 });
eq([d1.raw, d1.max], [3, 4], 'D 평가점수 합 3 · 배점 합 3+1=4 (N/A 항목 배점 제외)');
near(d1.pct, 75, 'D 총점 = 3/4×100');
eq(d1.judge, '개선 필요', 'D 75점 → 개선 필요');
eq(QA.scoreD(FD, { 1: 'N/A', 2: 'N/A', 3: 'N/A' }).pct, null, 'D 모두 N/A → null(0 나누기 없음)');
eq(QA.scoreD(FD, { 2: 3 }).invalid, ['2'], 'D 선택지에 없는 점수(배점 초과)는 받지 않는다');
eq([QA.judgeD(90), QA.judgeD(89.9), QA.judgeD(80), QA.judgeD(79.9), QA.judgeD(70), QA.judgeD(69.9)], ['우수', '양호', '양호', '개선 필요', '개선 필요', '전면 개선 필요'], 'D 판정 경계 90 · 80 · 70');
eq(QA.parseOptions('3 / 2 / 1 / 0', 3), [3, 2, 1, 0], 'D 점수배분 글자 「3 / 2 / 1 / 0」 읽기');
eq(QA.parseOptions('', 2), [2, 1, 0], 'D 점수배분이 비면 배점부터 0 까지');
eq(QA.parseOptions('3/1', 3), [3, 1, 0], 'D 선택지에 0 은 늘 있다');

/* ---------- B PSO: 체크형(점수 없음) ---------- */
var FB = { kind: 'B', preBasic: [{ no: '1', group: 'g', content: 'a' }, { no: '2', group: 'g', content: 'b' }, { no: '3', group: 'h', content: 'c' }],
  preDetail: [{ no: '1', process: 'p', item: 'x', point: '' }, { no: '2', process: 'p', item: 'y', point: '' }, { no: '3', process: 'q', item: 'z', point: '' }],
  psoBasic: [{ no: '1', group: 'g', content: 'd' }] };
var b1 = QA.scoreB(FB, { stage: 'Pre-PSO', values: { 1: '양호', 2: '개선요' }, detail: { 1: { res: 'OK', apply: '해당' }, 2: { res: 'NG', apply: '제외' }, 3: { res: 'NG', apply: '해당' } }, issues: [{ status: 2 }, { status: 4 }] });
eq([b1.basic['양호'], b1.basic['개선요'], b1.basic['미실시'], b1.basic.missing], [1, 1, 0, 1], 'PSO 기본 개수(미입력 따로)');
near(b1.goodRatio, 50, 'PSO 양호 비율 = 양호/입력 항목');
eq([b1.detail.OK, b1.detail.NG, b1.detail.excluded], [1, 1, 1], 'PSO 상세는 「제외」를 세지 않는다');
eq([b1.pct, b1.judge], [null, ''], 'PSO 는 점수·판정이 없다');
eq([b1.issues.count, b1.issues.byStatus[2], b1.issues.byStatus[4]], [2, 1, 1], 'Issue List Status 1~4 개수');
eq(QA.scoreB(FB, { stage: 'PSO', values: { 1: '미실시' } }).count, 1, 'PSO 단계는 PSO 기본 항목만(상세 없음)');

/* ---------- 양식 엑셀 읽기 ---------- */
function plain(list) { return list.map(function (it) { var o = {}; Object.keys(it).sort().forEach(function (k) { o[k] = it[k]; }); return o; }); }
['A', 'C', 'D'].forEach(function (k) {
  var b = QA.sampleFormBook(k), r = QA.parseFormBook(k, b.sheets, b.names);
  eq(plain(r.items), plain(QA.SAMPLE_FORMS[k].items), k + ' 예제 양식 표 → 항목·배점·가중치가 그대로 돌아온다');
});
var bB = QA.sampleFormBook('B'), rB = QA.parseFormBook('B', bB.sheets, bB.names);
eq([plain(rB.preBasic), plain(rB.preDetail), plain(rB.psoBasic)], [plain(QA.SAMPLE_FORMS.B.preBasic), plain(QA.SAMPLE_FORMS.B.preDetail), plain(QA.SAMPLE_FORMS.B.psoBasic)], 'PSO 예제 통합문서 → Pre-PSO 기본·상세 · PSO 기본 시트를 각각 찾는다');
var rA = QA.parseFormBook('A', QA.sampleFormBook('A').sheets);
eq(rA.headerRow, 4, '머리글 위 제목·기본 정보 줄을 건너뛰고 머리글 줄을 찾는다');
eq(rA.items[1].process, '단품', '공정 이름이 빈 칸이면 위 행에서 물려받는다');
eq(rA.items.length, 14, 'TOTAL 줄에서 멈춘다');
var rC = QA.parseFormBook('C', QA.sampleFormBook('C').sheets, ['결과 종합', '세부 점검 결과']);
eq(rC.sheet, '세부 점검 결과', '머리글이 없는 시트는 건너뛰고 다음 시트에서 찾는다');
// CTQ 표시만 있고 가중치 칸이 비면 CTQ → 2
var aoaA = [['순', '항목', '공정', '점검내용', '배점', '가중치'], [1, 'CTQ', '용접', '조건 확인', '', ''], [2, '', '', '외관 확인', '', 1], [3, '', '검사', '기록', '', 1]];
var pA = QA.parseTable('A', aoaA);
eq(pA.items.map(function (x) { return [x.process, x.weight, x.ctq]; }), [['용접', 2, true], ['용접', 1, false], ['검사', 1, false]], 'A 가중치가 비면 CTQ 표시로 2 · 공정 물려받기');
ok(pA.warnings.length === 1 && /1번 가중치/.test(pA.warnings[0]), '빈 가중치를 채우면 경고를 남긴다', JSON.stringify(pA.warnings));
// 머리글 낱말이 다른 양식 → 자동 찾기 실패 → 사용자가 고른 열로 읽기
var aoaX = [['구역', '번', '내용물', 'w', '값'], ['P1', 1, '첫 항목', 2, ''], ['', 2, '둘째 항목', 1, '']];
ok(!QA.parseTable('C', aoaX).ok, '머리글 낱말이 다르면 자동으로 찾지 못한다');
var pX = QA.parseTable('C', aoaX, { headerRow: 0, map: { process: 0, no: 1, content: 2, weight: 3, score: 4 } });
eq(pX.items.map(function (x) { return [x.no, x.process, x.weight, x.content]; }), [['1', 'P1', 2, '첫 항목'], ['2', 'P1', 1, '둘째 항목']], '사용자가 고른 열로 읽는다');
var pDup = QA.parseTable('D', [['No', '구분', '점검 항목', '배점', '점수배분'], [1, 'G', 'a', 3, '3 / 1 / 0'], [1, '', 'b', 2, ''], [2, '', 'c', 5, '']]);
eq(pDup.items.map(function (x) { return x.no + ':' + x.options.join(''); }), ['1:310', '1-2:210'], 'D 배점 1~3 아닌 행은 빼고, 겹친 번호는 1-2 로 바꾼다');
eq(pDup.warnings.length, 2, '뺀 행 · 겹친 번호 경고 2개');
// 저장소의 예제 엑셀 파일(tools/make-samples.js 산출)을 SheetJS 로 다시 읽기
var FILES = { C: 'form-C-process-audit.xlsx', A: 'form-A-large-fab-audit.xlsx', B: 'form-B-pso.xlsx', D: 'form-D-paint-audit.xlsx' };
QA.ORDER.forEach(function (k) {
  var wb = XLSX.read(fs.readFileSync(path.join(__dirname, '..', 'samples', FILES[k])), { type: 'buffer' }), sh = {};
  wb.SheetNames.forEach(function (n) { sh[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true }); });
  var r = QA.parseFormBook(k, sh, wb.SheetNames), f = QA.makeForm(k, r);
  eq([r.ok, QA.formSize(f)], [true, QA.formSize(QA.sampleForms().filter(function (x) { return x.kind === k; })[0])], k + ' 예제 엑셀 파일을 읽으면 항목 수가 같다');
});
eq([QA.formMax(QA.makeForm('A', { items: QA.SAMPLE_FORMS.A.items })), QA.formMax(QA.makeForm('D', { items: QA.SAMPLE_FORMS.D.items }))], [60, 22], '예제 양식 만점: 대형 제관 (CTQ 6×2 + 8)×3 = 60 · 도장 22');

/* ---------- 지적사항 상태 · 기한 초과 · 재발 ---------- */
var st = function (o) { return QA.findingStatus(o); };
eq([st({ finding: '' }), st({ finding: 'x' }), st({ finding: 'x', planDate: '2026-11-10' }), st({ finding: 'x', planDate: '2026-11-10', doneDate: '2026-11-05' }), st({ finding: 'x', planDate: '2026-11-10', doneDate: '2026-11-05', verifiedDate: '2026-11-06' })],
  ['', '계획 미수립', '개선 진행중', '개선 완료', '확인 완료'], '결과 식: 빈칸 → 계획 미수립 → 개선 진행중 → 개선 완료 → 확인 완료');
eq([QA.isOverdue({ finding: 'x', planDate: '2026-11-02' }, TODAY), QA.isOverdue({ finding: 'x', planDate: TODAY }, TODAY), QA.isOverdue({ finding: 'x', planDate: '2026-11-01', doneDate: '2026-11-02' }, TODAY)], [true, false, false], '기한 초과: 계획일정이 지났고 완료일정이 없을 때만(당일은 아님)');
eq(QA.isOverdue({ finding: 'x', dueDate: '2026-10-01' }, TODAY), true, '계획이 없으면 완료 요청일로 기한 초과를 본다');
eq(QA.isOverdue({ finding: '', dueDate: '2026-10-01' }, TODAY), false, '지적이 없으면 기한도 없다');
var F0 = [
  { id: 'a', vendorId: 'v1', kind: 'A', itemNo: '6', finding: 'x', date: '2026-01-01' },
  { id: 'b', vendorId: 'v1', kind: 'A', itemNo: '6', finding: 'y', date: '2026-06-01' },
  { id: 'c', vendorId: 'v2', kind: 'A', itemNo: '6', finding: 'z', date: '2026-07-01' },
  { id: 'd', vendorId: 'v1', kind: '', process: '용접', type: '공정', finding: 'w', date: '2026-08-01' },
  { id: 'e', vendorId: 'v1', kind: '', process: '용접', type: '공정', finding: 'w2', date: '2026-09-01' }];
eq(F0.map(function (f) { return QA.recurOf(f, F0); }), ['신규', '재발', '신규', '신규', '재발'], '재발: 같은 업체 · 같은 원인 항목(번호 없으면 공정+유형)이 그 전에 있을 때');
var rep = QA.repeatAnalysis(F0);
eq(rep.map(function (g) { return [g.key, g.count, g.vendorCount]; }), [['A#6', 3, 2], ['P#용접#공정', 2, 1]], '반복 지적 분석: 2회 이상만, 많은 순');
var cnt = QA.findingCounts([{ finding: 'x' }, { finding: 'x', planDate: '2026-10-01' }, { finding: 'x', planDate: '2026-10-01', doneDate: '2026-10-02', verifiedDate: '2026-10-03' }, { finding: '' }], TODAY);
eq([cnt.total, cnt.open, cnt.closed, cnt.overdue], [3, 2, 1, 1], '지적 집계(빈 지적은 세지 않음)');

/* ---------- 이력 · 비교 · 선택 조건 ---------- */
var S = QA.sample(TODAY), db = S.db;
eq(JSON.stringify(QA.sample(TODAY)), JSON.stringify(S), '같은 기준일이면 같은 예제');
eq([db.managers.length, db.vendors.length], [2, 4], '예제: 담당자 2명 · 업체 4곳');
ok(db.managers.concat(db.vendors).every(function (x) { return /\(예제\)$/.test(x.name); }), '예제 이름에는 모두 (예제) 표시');
var h1 = QA.history(db, 'v1', 'A');
eq(h1.map(function (a) { return a.round; }), [1, 2, 3], '이력은 실시일 순 · 차수');
eq(QA.nextRound(db, 'v1', 'A'), 4, '다음 차수 = 이력 수 + 1');
eq(QA.previousOf(db, h1[2]).id, h1[1].id, '이전 Audit = 같은 업체·종류의 바로 앞');
var cp = QA.compare(db, h1[1], h1[2]);
var s1 = QA.score('A', QA.formOf(db, h1[1]), h1[1]), s2 = QA.score('A', QA.formOf(db, h1[2]), h1[2]);
near(cp.delta, s2.pct - s1.pct, '이전 대비 증감 = 이번 − 이전 백분율');
ok(cp.sameForm && cp.items.length > 0 && cp.items.every(function (x) { return x.before !== x.after; }), '같은 양식이면 바뀐 항목만 모은다', cp.items.length);
var other = JSON.parse(JSON.stringify(h1[2])); other.formId = 'other'; var db2 = JSON.parse(JSON.stringify(db)); db2.forms.push(QA.makeForm('A', { items: QA.SAMPLE_FORMS.A.items.slice(0, 5) }, { id: 'other' }));
var cp2 = QA.compare(db2, h1[1], other);
eq([cp2.sameForm, cp2.items.length], [false, 0], '양식이 다르면 항목별 비교 없이 백분율만');
eq(QA.scopeOf(db, {}).mode, 'all', '담당자 미선택 → 전체');
eq(QA.scopeOf(db, { managerId: 'm1' }).vendorIds, ['v1', 'v2'], '담당자 선택 → 그 담당자의 업체 전체');
eq(QA.scopeOf(db, { managerId: 'm1', vendorId: 'v1' }).mode, 'vendor', '담당자 + 업체 → 업체 상세');
eq(QA.scopeOf(db, { managerId: 'm2', vendorId: 'v1' }).mode, 'manager', '다른 담당자의 업체는 선택이 풀린다');
var dAll = QA.dashboard(db, {}, TODAY), dM = QA.dashboard(db, { managerId: 'm1' }, TODAY), dV = QA.dashboard(db, { managerId: 'm1', vendorId: 'v1' }, TODAY);
eq([dAll.kpi.vendors, dAll.kpi.audits, dM.kpi.vendors, dV.kpi.audits], [4, db.audits.length, 2, db.audits.filter(function (a) { return a.vendorId === 'v1'; }).length], '대시보드 3단: 전체 · 담당자 · 업체');
ok(dAll.kpi.findings.overdue > 0, '예제에 기한 초과 지적이 있다', dAll.kpi.findings.overdue);
ok(dV.detail && dV.detail.series.length >= 2 && dV.detail.open.length > 0, '업체 상세: 점수 변화 · 미완료 개선사항');
var r1 = QA.vendorRow(db, 'v1', TODAY), lastPcts = QA.SCORED.map(function (k) { return r1.last[k] && r1.last[k].pct; }).filter(function (x) { return x != null; });
near(r1.avgPct, lastPcts.reduce(function (a, b) { return a + b; }, 0) / lastPcts.length, '업체 평균 = 점수형 종류별 최근 Audit 백분율 평균(PSO 제외)');
ok(db.audits.some(function (a) { var c = QA.compare(db, QA.previousOf(db, a), a); return c && c.delta > 5; }) && db.audits.some(function (a) { var c = QA.compare(db, QA.previousOf(db, a), a); return c && c.delta < -5; }), '예제 이력에 점수가 오른 곳 · 내린 곳이 모두 있다');
var weak = QA.weakProcesses(db, ['v1', 'v2', 'v3', 'v4']);
ok(weak.every(function (g, i) { return i === 0 || (weak[i - 1].avgPct == null ? 101 : weak[i - 1].avgPct) <= (g.avgPct == null ? 101 : g.avgPct); }), '취약 공정은 평균 백분율 낮은 순');
var imp = QA.improvement(db, 'v3', TODAY).kinds.filter(function (k) { return k.kind === 'D'; })[0];
near(imp.change, imp.last - imp.first, '개선 효과 = 최근 − 첫 Audit 백분율');

/* ---------- 메일 초안 ---------- */
var insp = db.inspections[0];
var mi = QA.buildMail('internal', insp, { vendorName: 'A정밀(예제)', inspectorName: '김품질(예제)' });
ok(['1. 점검 개요', '2. 주요 점검 결과', '3. 주요 문제점', '4. 개선 요청사항', '5. 업체 조치계획', '6. 종합 의견'].every(function (t) { return mi.body.indexOf(t) >= 0; }), '내부 보고 6개 절');
ok(/공정점검 보고/.test(mi.subject) && /A정밀/.test(mi.subject), '내부 보고 제목에 업체');
eq(mi.missing, [], '다 채운 점검은 빠진 정보가 없다');
var mv = QA.buildMail('vendor', insp, { vendorName: 'A정밀(예제)', inspectorName: '김품질(예제)' });
ok(/회신해 주시기 바랍니다/.test(mv.body) && /개선 완료 요청일/.test(mv.body) && /품질 담당자님께/.test(mv.body), '업체 발송: 요청일 · 회신 요청 · 정중한 문체');
ok(/첫 회신은 \d{4}-\d{2}-\d{2}까지/.test(mv.body), '회신 기한 = 가장 이른 완료 예정일');
var bare = QA.buildMail('vendor', { date: '', rows: [{ process: '용접', problem: '균열', request: '보수' }] }, {});
eq(bare.missing.sort(), ['대상 공정', '업체명', '완료 예정일', '점검 목적', '점검 일자'].sort(), '비어 있는 정보는 missing 으로 모은다');
ok(!/\d{4}-\d{2}-\d{2}/.test(bare.body) && /\(입력 없음\)/.test(bare.body), '입력되지 않은 날짜를 지어내지 않는다');
ok(/사진: 문제점 2장 · 개선 1장/.test(mi.body), '사진 장수와 설명을 본문에 적는다');
ok(/^mailto:\?subject=/.test(QA.mailto('', '제목 &', '본문')) && QA.mailto('', '제목 &', '본문').indexOf('%26') > 0, 'mailto 는 제목·본문을 인코딩한다');

/* ---------- 사진 · 내보내기 · 백업 ---------- */
eq(QA.fitSize(4000, 3000, 1280), { w: 1280, h: 960, scaled: true }, '사진은 긴 변 1280 으로 줄인다');
eq(QA.fitSize(800, 600, 1280).scaled, false, '작은 사진은 그대로');
var rs = QA.reportSheets(db, null, TODAY);
eq(rs.names, ['Audit결과', '항목별점수', '지적사항', '공정점검', '메일이력'], '엑셀 시트 5장');
eq(rs.sheets['Audit결과'].length - 1, db.audits.length, 'Audit결과 행 수 = Audit 수');
ok(rs.sheets['지적사항'][0].indexOf('결과') >= 0 && rs.sheets['지적사항'].slice(1).some(function (r) { return r[17] === '기한 초과'; }), '지적사항 시트에 결과 · 기한 초과');
eq(QA.reportSheets(db, ['v3'], TODAY).sheets['Audit결과'].length - 1, db.audits.filter(function (a) { return a.vendorId === 'v3'; }).length, '내보내기는 선택 조건의 업체만');
var bk = QA.restore(QA.backup(db, S.photos, TODAY));
eq([bk.ok, bk.db.audits.length, bk.photos.length], [true, db.audits.length, S.photos.length], '백업 → 복원 왕복');
eq(QA.restore('{"schema":"other","db":{}}').ok, false, '다른 도구의 JSON 은 복원하지 않는다');
eq(QA.restore('not json').ok, false, 'JSON 이 아니면 복원하지 않는다');

/* ---------- 엑셀에서 복사해 붙여넣기 · CSV · TXT (회사 노트북 DRM · 폐쇄망, v1.1) ---------- */
var TAB = '\t', NL = '\r\n';
// 엑셀 범위 복사는 탭 · CRLF, 줄바꿈이 든 칸은 따옴표로 감싸고 맨 끝에 줄바꿈 하나가 붙는다
var pt = QA.parsePaste(['제목 줄', '', 'No' + TAB + '구분' + TAB + '점검 항목' + TAB + '배점', '1' + TAB + '전처리' + TAB + '"표면\n상태"' + TAB + '3', '2' + TAB + '' + TAB + '도료 "A" 관리' + TAB + '1,234', '', ''].join(NL) + NL);
eq(pt.delim, 'tab', '붙여넣기: 탭이 있으면 탭으로 나눈다(엑셀 복사)');
eq(pt.aoa[3][2], '표면\n상태', '붙여넣기: 따옴표로 감싼 칸 안의 줄바꿈은 칸의 일부');
eq(pt.aoa[4][2], '도료 "A" 관리', '붙여넣기: 감싸지 않은 칸의 따옴표는 그대로');
eq([pt.rows, pt.cols], [5, 4], '붙여넣기: 끝의 빈 줄은 버리고 가운데 빈 줄은 남긴다');
eq(pt.aoa[1], ['', '', '', ''], '붙여넣기: 모든 줄의 칸 수를 맞춘다');
eq(QA.num(pt.aoa[4][3]), 1234, '붙여넣기: 천 단위 쉼표 숫자 1,234 → 1234 (탭 구분이라 칸이 갈리지 않는다)');
var pq = QA.parsePaste('a,b,c\n"1,234","x ""y""",3\n');
eq([pq.delim, pq.aoa[1]], ['comma', ['1,234', 'x "y"', '3']], 'CSV: 쉼표 구분 · 따옴표 칸 · "" → "');
eq(QA.parsePaste('a,b\tc\n', { delim: '\t' }).aoa[0], ['a,b', 'c'], '구분 글자를 정해 주면 그대로 쓴다(.tsv)');
eq(QA.parsePaste('﻿  가 \t 나 \n').aoa[0], ['가', '나'], '붙여넣기: BOM · 칸 앞뒤 공백 · 줄바꿈 없는 공백을 걷는다');
eq(QA.parsePaste('').aoa, [], '빈 붙여넣기 → 빈 표');
var rtA = [['번호', '내용', '비고'], ['1', '줄\n바꿈', 'tab\tin'], ['2', '따옴표 "q"', '']];
eq(QA.parsePaste(QA.toTSV(rtA)).aoa, rtA, 'toTSV → parsePaste 왕복(줄바꿈 · 탭 · 따옴표 칸)');
ok(/^﻿/.test(QA.toCSV([['가']])) && QA.parsePaste(QA.toCSV([['1,5', '나']])).aoa[0].join('|') === '1,5|나', 'toCSV: BOM + 쉼표 칸은 따옴표 · 다시 읽으면 같다');
// 글자 파일 인코딩: 한국어 윈도 엑셀의 「CSV(쉼표로 분리)」는 CP949
eq(QA.decodeText(Buffer.from([0xB9, 0xF8, 0xC8, 0xA3, 0x2C, 0xB9, 0xE8, 0xC1, 0xA1])), '번호,배점', 'CSV 인코딩: CP949(euc-kr) 바이트를 한글로 읽는다');
eq(QA.decodeText(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('번호,배점', 'utf8')])), '번호,배점', 'CSV 인코딩: UTF-8 BOM');
eq(QA.decodeText(Buffer.from('점검 항목', 'utf8')), '점검 항목', 'CSV 인코딩: BOM 없는 UTF-8');

// 붙여넣기 → 양식 읽기 = 파일 읽기와 같은 결과 (예제 양식 4종 전부)
['A', 'C', 'D'].forEach(function (k) {
  var book = QA.sampleFormBook(k);
  var fileRes = QA.parseFormBook(k, book.sheets, book.names), sh = fileRes.sheet;   // 양식 시트를 골라 복사한 경우
  var pb = QA.pasteBook(k, QA.toTSV(book.sheets[sh]));
  var pasteRes = QA.parseFormBook(k, pb.sheets, pb.names);
  ok(pasteRes.ok && JSON.stringify(pasteRes.items) === JSON.stringify(fileRes.items), k + ' 양식: 엑셀 범위를 붙여 넣으면 파일과 같은 항목 · 배점 · 공정 묶음(' + (fileRes.items || []).length + '개)', pasteRes.error);
  eq(pasteRes.headerRow, fileRes.headerRow, k + ' 양식: 위쪽 제목 줄이 섞여도 같은 머리글 줄을 찾는다');
});
var bookB = QA.sampleFormBook('B'), fileB = QA.parseFormBook('B', bookB.sheets, bookB.names);
var pB = QA.pasteBook('B', QA.toTSV(bookB.sheets['Pre-PSO(기본)']), null, 'preBasic');
pB = QA.pasteBook('B', QA.toTSV(bookB.sheets['Pre-PSO(상세)']), pB, 'preDetail');
pB = QA.pasteBook('B', QA.toTSV(bookB.sheets['PSO(기본)']), pB, 'psoBasic');
var rB = QA.parseFormBook('B', pB.sheets, pB.names);
ok(rB.ok && JSON.stringify([rB.preBasic, rB.preDetail, rB.psoBasic]) === JSON.stringify([fileB.preBasic, fileB.preDetail, fileB.psoBasic]), 'PSO: 부분 3개를 차례로 붙여 넣으면 파일과 같은 Pre-PSO 기본 · 상세 · PSO 기본', rB.error);
var pB2 = QA.pasteBook('B', QA.toTSV(bookB.sheets['PSO(기본)']), pB, 'psoBasic');
eq(pB2.names.length, 3, 'PSO: 같은 부분을 다시 붙이면 바꿔 쓴다(쌓이지 않는다)');
// 쉼표 숫자 · 빈 줄 · 합계 줄 — 파일 읽기 규칙 그대로
var tsvC = ['Process Audit', 'No' + TAB + '공정' + TAB + '점검 내용' + TAB + '점수' + TAB + '가중치', '1' + TAB + '절단' + TAB + '절단면 확인' + TAB + '' + TAB + '2',
  '', '2' + TAB + '' + TAB + '치수 확인' + TAB + '' + TAB + '1', '', '', '1,001' + TAB + '용접' + TAB + '비드 확인' + TAB + '' + TAB + ' 2 ', '합계' + TAB + '' + TAB + '' + TAB + '' + TAB + '10', '9' + TAB + 'x' + TAB + '합계 뒤' + TAB + '' + TAB + '1'].join(NL);
var rC = QA.parseFormBook('C', QA.pasteBook('C', tsvC).sheets, ['붙여넣기']);
eq(rC.items.map(function (it) { return [it.no, it.process, it.weight]; }), [['1', '절단', 2], ['2', '절단', 1], ['1001', '용접', 2]], 'C 붙여넣기: 빈 줄 2개는 건너뛰고 · 공정은 물려받고 · 1,001 → 1001 · 합계 줄에서 멈춘다');
var rC3 = QA.parseFormBook('C', QA.pasteBook('C', ['No\t공정\t점검 내용\t점수\t가중치', '1\tP\ta\t\t1', '', '', '', '2\tP\tb\t\t1'].join('\n')).sheets, ['붙여넣기']);
eq(rC3.items.length, 1, '붙여넣기: 빈 줄 3개에서 멈춘다(파일 읽기와 같음)');
eq(QA.parseFormBook('D', QA.pasteBook('D', '아무 글자\t아무 칸\n1\t2').sheets, ['붙여넣기']).ok, false, '머리글이 없는 붙여넣기는 읽지 않고 필요한 열을 알린다');

// 날짜
eq(['2026-11-04', '2026.11.04', '2026. 11. 4.', '2026/11/4', '2026년 11월 4일', '2026년11월4일', '26.11.04', '20261104', '2026-11-04 09:30', '2026-11-04 오후 3:05', '2026.11.04(수)', 46330, '46330']
  .map(function (v) { return QA.normDate(v); }), Array(13).join('2026-11-04,').split(',').slice(0, 12).concat(['2026-11-04']), '날짜: 하이픈 · 점 · 빗금 · 한글 · 두 자리 연도 · 8자리 · 시각 · 요일 · 엑셀 일련번호');
eq([QA.normDate('11/4', { year: 2026 }), QA.normDate('11월 4일', { year: '2026' }), QA.normDate('11/4')], ['2026-11-04', '2026-11-04', null], '날짜: 연도 없는 날은 점검 연도가 있을 때만');
eq([QA.normDate('2026-02-30'), QA.normDate('2026-13-01'), QA.normDate('다음 주'), QA.normDate(''), QA.normDate(null), QA.normDate(5)], [null, null, null, '', '', null], '날짜: 없는 날 · 글자는 null, 빈 칸은 빈 값');

// 공정점검 행 붙여넣기
var tsvI = ['공정점검 결과', 'No.\t점검 공정\t점검 항목\t확인 내용\t문제점\t문제점 사진\t개선 요청사항\t개선 사진\t담당자\t완료 예정일\t진행상태',
  '1\t용접\t용접 조건\t전류 측정\t조건표와 다름\t(사진)\t조건 맞추기\t\t업체 생산\t2026. 11. 20.\t조치중',
  '2\t\t\t\t\t\t\t\t\t\t', '3\t검사\t기록\t"기록지\n확인"\t\t\t\t\t\t11/30\t완료', '4\t도장\t두께\t측정\t얇음\t\t재도장\t\t\t다음 주\t보류'].join(NL);
var ri = QA.parseInspectRows(QA.parsePaste(tsvI).aoa, { year: 2026 });
eq(ri.rows.map(function (r) { return [r.process, r.item, r.problem, r.request, r.due, r.state]; }),
  [['용접', '용접 조건', '조건표와 다름', '조건 맞추기', '2026-11-20', '조치 중'], ['검사', '기록', '', '', '2026-11-30', '완료'], ['도장', '두께', '얇음', '재도장', '', '요청']], '공정점검 붙여넣기: 한글 머리글로 열 찾기 · 번호만 있는 줄 건너뛰기 · 날짜 · 상태 맞추기');
eq(ri.rows[1].check, '기록지\n확인', '공정점검 붙여넣기: 줄바꿈 든 칸');
eq(ri.headerRow, 1, '공정점검 붙여넣기: 제목 줄 아래 머리글을 찾는다');
ok(ri.warnings.length === 2 && /다음 주/.test(ri.warnings[0]) && /보류/.test(ri.warnings[1]), '공정점검 붙여넣기: 못 읽은 날짜 · 상태는 경고(지어내지 않음)', JSON.stringify(ri.warnings));
ok(ri.rows.every(function (r) { return Array.isArray(r.problemPhotos) && Array.isArray(r.fixPhotos); }), '공정점검 붙여넣기: 사진 칸은 빈 목록');
var rn = QA.parseInspectRows(QA.parsePaste('1\t절단\t치수\t측정\t초과\t재측정\t홍길동\t2026-12-01\t완료\n2\t용접\t비드\t육안\t\t\t\t\t').aoa);
eq(rn.rows.map(function (r) { return [r.process, r.problem, r.owner, r.due, r.state]; }), [['절단', '초과', '홍길동', '2026-12-01', '완료'], ['용접', '', '', '', '요청']], '공정점검 붙여넣기: 머리글이 없으면 화면 열 순서(앞의 번호 열은 건너뜀)');
ok(/머리글 줄이 없어/.test(rn.warnings[0]), '공정점검 붙여넣기: 머리글 없이 읽었다고 알린다');
eq(QA.parseInspectRows([]).ok, false, '공정점검 붙여넣기: 빈 표는 읽지 않는다');

console.log('\n규칙 통과 ' + passed + ' · 실패 ' + failed);
process.exit(failed ? 1 : 0);
