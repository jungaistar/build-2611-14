/* 오프라인 사용 파일 만들기 — node tools/make-offline.js
 * 폐쇄망(인터넷 없는 회사 PC)에서 쓰도록 index.html 에 css · lib(SheetJS) · js 를 모두 넣은 HTML 하나를 만든다.
 * 결과: offline/qa-2611-14-offline.html (사이트 「데이터 관리 → 오프라인 사용 파일 받기」가 이 파일을 내려준다)
 * 같은 입력이면 같은 결과가 나온다(만든 시각을 넣지 않는다) — tools/check-offline.js 가 최신인지 대조한다.
 * JS 를 고치면 이것을 다시 돌려 함께 커밋한다. */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, 'offline', 'qa-2611-14-offline.html');

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
// <script> 안에 넣을 때 HTML 해석기가 스크립트를 일찍 닫거나(</script) 주석 모드로 들어가지(<!--) 않게 한다.
// 문자열 · 정규식 안에서 \/ 와 \! 는 같은 글자라 동작은 바뀌지 않는다.
function scriptSafe(js) { return js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'); }
function styleSafe(css) { return css.replace(/<\/style/gi, '<\\/style'); }

function build() {
  var plan = JSON.parse(read('docs/plan.json'));
  var html = read('index.html');
  // 1) 바깥 주소가 든 머리 정보(공유 미리보기 · 대표 주소)는 뺀다 — 오프라인 파일에서는 쓰이지 않는다
  html = html.replace(/^[ \t]*<link rel="canonical"[^>]*>\r?\n/m, '')
    .replace(/^[ \t]*<meta (property="og:[^"]*"|name="twitter:[^"]*"|name="robots")[^>]*>\r?\n/gm, '');
  // 2) 아이콘은 data: 주소로
  var fav = Buffer.from(read('favicon.svg')).toString('base64');
  html = html.replace(/<link rel="icon" href="favicon\.svg"[^>]*>/, '<link rel="icon" href="data:image/svg+xml;base64,' + fav + '">');
  // 3) 스타일 넣기
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (m, href) { return '<style>/* ' + href + ' */\n' + styleSafe(read(href)) + '\n</style>'; });
  // 4) 다른 페이지(사용법 · 기획서)로 가는 링크는 파일 하나에 없으므로 뺀다. 브랜드 링크는 화면 첫 메뉴로.
  html = html.replace(/^[ \t]*<li><a href="(guide|plan)\.html">[^<]*<\/a><\/li>\r?\n/gm, '')
    .replace('<a class="topnav-brand" href="index.html">', '<a class="topnav-brand" href="#/dashboard">');
  html = html.replace('<div class="eyebrow">', '<div class="eyebrow">오프라인 파일 v' + plan.version + ' · ');
  // 5) 스크립트 넣기(순서 그대로) + 오프라인 표시
  var flag = '<script>window.QA_OFFLINE = { version: ' + JSON.stringify(plan.version) + ' };</script>\n';
  var first = true;
  html = html.replace(/<script src="([^"]+)"><\/script>/g, function (m, src) {
    var s = (first ? flag : '') + '<script>/* ' + src + ' */\n' + scriptSafe(read(src)) + '\n</script>';
    first = false; return s;
  });
  html = html.replace('<html lang="ko">', '<html lang="ko">\n<!-- 협력업체 통합 품질관리 오프라인 파일 v' + plan.version + ' — 인터넷 없이 열립니다(css · js · SheetJS 를 이 파일 하나에 넣었습니다). tools/make-offline.js 로 만든 파일이니 직접 고치지 마세요. -->');
  return html;
}

if (require.main === module) {
  var out = build();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  console.log('오프라인 파일: ' + path.relative(ROOT, OUT) + ' (' + Math.round(out.length / 1024) + ' KB)');
}
module.exports = { build: build, OUT: OUT };
