/* 예제 양식 엑셀 4종 만들기 — node tools/make-samples.js
 * 실제 회사 양식이 아니다. 엔진의 SAMPLE_FORMS(지어낸 항목)를 회사 양식과 같은 모양
 * (제목·기본 정보 줄 → 머리글 → 항목, 공정 이름은 묶음 첫 행에만, TOTAL 줄)으로 찍는다.
 * 「데이터 관리 → 양식 엑셀 올리기」와 test/logic.test.js 가 이 파일을 다시 읽어 항목이 그대로인지 본다. */
'use strict';
var fs = require('fs'), path = require('path');
var QA = require('../js/audit.js');
var XLSX = require('../lib/xlsx.full.min.js');
var FILES = { C: 'form-C-process-audit.xlsx', A: 'form-A-large-fab-audit.xlsx', B: 'form-B-pso.xlsx', D: 'form-D-paint-audit.xlsx' };
QA.ORDER.forEach(function (k) {
  var b = QA.sampleFormBook(k), wb = XLSX.utils.book_new();
  b.names.forEach(function (n) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(b.sheets[n]), n); });
  var f = path.join(__dirname, '..', 'samples', FILES[k]);
  fs.writeFileSync(f, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log(f);
});
module.exports = FILES;
