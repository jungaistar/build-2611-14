/* 오프라인 파일 검사 — node tools/check-offline.js [파일]
 * 폐쇄망에서 인터넷 없이 열리려면 바깥(http · https · //)이나 옆 파일(css/ · js/ · lib/)을 하나도 불러오면 안 된다.
 *  1) 파일이 있고, 지금 소스로 다시 만든 것과 같다(tools/make-offline.js 를 잊지 않았는지)
 *  2) 머리 · 본문 표시(마크업)에 src · href 로 부르는 바깥 자원이 없다(<script src> · <link href> · <img src> · <iframe> 는 data: 만)
 *  3) CSS 에 url( · @import 가 없다(글꼴 · 그림을 내려받지 않는다)
 *  4) JS 에 네트워크 호출이 없다 — fetch 는 선택 기능 「AI 문장 다듬기」의 두 주소만 허용(폐쇄망에서는 실패 안내만 뜨고 나머지 기능은 그대로)
 *  5) 화면 · 엔진 · SheetJS 가 실제로 들어 있다
 * 파일을 주면(예: 일부러 깨뜨린 사본) 1) 은 건너뛰고 그 파일만 검사한다. */
'use strict';
var fs = require('fs'), path = require('path');
var mk = require('./make-offline.js');
var arg = process.argv[2];
var file = arg ? path.resolve(arg) : mk.OUT;
var fails = [], passes = 0;
function check(c, label, detail) { if (c) passes++; else fails.push(label + (detail ? ' — ' + detail : '')); }

if (!fs.existsSync(file)) { console.log('  X 오프라인 파일이 없습니다: ' + file + '  (node tools/make-offline.js)'); process.exit(1); }
var html = fs.readFileSync(file, 'utf8');
if (!arg) check(html === mk.build(), '오프라인 파일이 최신 소스와 같다', 'node tools/make-offline.js 로 다시 만드세요');

// 스크립트 · 스타일 본문을 떼어 따로 본다
var scripts = [], styles = [];
var markup = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, function (m, attrs, body) { scripts.push({ attrs: attrs, body: body }); return '<script' + attrs + '></script>'; })
  .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function (m, body) { styles.push(body); return '<style></style>'; });

var ext = [];
markup.replace(/<(script|link|img|iframe|source|video|audio|embed|object|base)\b[^>]*>/gi, function (tag) {
  tag.replace(/\b(src|href|data|srcset|poster)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, function (m, a, _q, d1, d2, d3) {
    var v = (d1 || d2 || d3 || '').trim();
    if (!/^data:/i.test(v) && !/^#/.test(v)) ext.push(tag.slice(0, 80));
  });
});
check(!ext.length, '마크업이 바깥 · 옆 파일 자원을 부르지 않는다(data: · # 만)', ext.join(' | '));
var anyHttpAttr = markup.match(/\b(src|href)\s*=\s*["']?(https?:)?\/\//gi);
check(!anyHttpAttr, '마크업에 http(s) 주소 링크가 없다', (anyHttpAttr || []).join(' | '));
check(!/<meta[^>]+content=["']?https?:/i.test(markup), '머리 정보(meta)에 http(s) 주소가 없다');

var css = styles.join('\n');
check(styles.length >= 2, '스타일이 파일 안에 들어 있다', styles.length + '개');
check(!/url\s*\(/i.test(css), 'CSS 에 url( 이 없다(글꼴 · 그림 내려받기 없음)');
check(!/@import/i.test(css), 'CSS 에 @import 가 없다');
check(!/@font-face/i.test(css), '웹 글꼴(@font-face)을 쓰지 않는다 — PC 에 있는 글꼴로 그린다');

var js = scripts.map(function (s) { return s.body; }).join('\n');
check(scripts.every(function (s) { return !/\bsrc\s*=/.test(s.attrs); }), '스크립트가 모두 파일 안에 들어 있다(<script src> 없음)');
var ALLOW_FETCH = ['https://api.anthropic.com/v1/messages', 'https://api.openai.com/v1/chat/completions'];
var fetches = js.match(/\bfetch\s*\(\s*[^,)]*/g) || [];
var badFetch = fetches.filter(function (f) { return !ALLOW_FETCH.some(function (u) { return f.indexOf("'" + u + "'") >= 0; }); });
check(!badFetch.length, 'JS 의 fetch 는 선택 AI 두 주소뿐', badFetch.join(' | '));
['XMLHttpRequest', 'importScripts', 'new Worker', 'sendBeacon', 'WebSocket', 'EventSource', 'import(', '.createElement(\'script\')', '.createElement("script")'].forEach(function (k) {
  check(js.indexOf(k) < 0, 'JS 에 ' + k + ' 가 없다');
});
var srcAssign = js.match(/\.(src|href)\s*=\s*['"](https?:)?\/\/[^'"]*/g);
check(!srcAssign, 'JS 가 바깥 주소를 src · href 로 넣지 않는다', (srcAssign || []).join(' | '));
var strRef = js.match(/(src|href)=\\?["'](https?:)?\/\/[^"'\\]*/g);
check(!strRef, 'JS 가 그리는 마크업에 바깥 주소 src · href 가 없다', (strRef || []).join(' | '));

check(/window\.QA_OFFLINE\s*=/.test(js), '오프라인 표시(QA_OFFLINE)가 있다');
check(/SheetJS/.test(js) && /XLSX/.test(js), 'SheetJS(엑셀 읽기 · 내보내기)가 들어 있다');
check(/parseFormBook/.test(js) && /parsePaste/.test(js), '엔진(audit.js · 붙여넣기 읽기)이 들어 있다');
check(/function viewDashboard/.test(js), '화면(app.js)이 들어 있다');
check(scripts.length === 4, '스크립트 4개(오프라인 표시 · SheetJS · 엔진 · 화면)가 하나도 일찍 닫히지 않고 들어 있다', scripts.length + '개');

if (fails.length) { fails.forEach(function (f) { console.log('  X ' + f); }); }
console.log('오프라인 검사 통과 ' + passes + ' · 실패 ' + fails.length + '  (' + path.relative(process.cwd(), file) + ', ' + Math.round(html.length / 1024) + ' KB)');
process.exit(fails.length ? 1 : 0);
