# build-2611-14 · 협력업체 통합 품질관리

생성형 AI 업무자동화 전문가과정 **2차수** 수강생 프로젝트 14 — 기획 정유석.

**바로 쓰기: https://build-2611-14.jobability.co.kr/**

담당자·업체를 한 번 고르면 모든 메뉴가 그 조건을 따릅니다. 협력업체 Audit 4종(Process · 대형 제관 · PSO · 도장)의 점수와 판정,
지적사항의 개선조치 추적(확인 완료 · 기한 초과 · 재발), 업체별 점수 변화와 취약 공정, 가로형 공정점검(사진 첨부),
내부 보고·업체 발송 메일 초안을 한 화면에서 관리합니다.
회사 Audit 양식 엑셀을 올리면 항목과 배점을 그대로 읽어 씁니다. 회사 노트북에서 엑셀 파일을 고를 수 없으면(DRM) 엑셀 범위를 복사해 붙여 넣고, 인터넷이 없는 PC 에서는 「오프라인 사용 파일」(HTML 하나)을 받아 씁니다. 자료는 이 PC 의 브라우저(IndexedDB)에만 저장되고 서버로 올라가지 않습니다.

| 파일 | 역할 |
|---|---|
| `js/audit.js` | 엔진(점수식 4종 · 판정 · 지적 상태 · 기한 초과 · 재발 · 대시보드 집계 · 점수 분석 · 양식 엑셀 읽기 · 메일 초안 · 내보내기 · 예제) — 계산은 전부 여기 |
| `js/app.js` | 화면(사이드바 메뉴 · 선택 조건 · 입력 표 · SVG 그래프 · 사진 · IndexedDB 저장 · 엑셀/JSON) |
| `samples/*.xlsx` | 예제 양식 엑셀 4종(회사 양식과 같은 모양, 항목은 지어낸 것) — `node tools/make-samples.js` 로 다시 만든다 |
| `test/logic.test.js` | 계산 규칙 테스트 `node test/logic.test.js` |
| `test/smoke.browser.js` | 화면 연기 테스트(playwright) — 끝에 인터넷을 끊은 브라우저로 오프라인 파일을 file:// 로 열어 본다 |
| `offline/qa-2611-14-offline.html` | 오프라인 사용 파일(css · js · SheetJS 를 넣은 HTML 하나) — `node tools/make-offline.js` 로 만든다. JS · CSS · index.html 을 고치면 다시 만들어 함께 커밋 |
| `tools/check-offline.js` | 오프라인 파일 검사 — 최신인지 · 바깥(http · https) 자원 · 네트워크 호출이 없는지 |
| `CLAUDE.md` | 작업 지시서 + 기획서 원문 |

예제 데이터와 예제 양식은 실제 사내 데이터·양식이 아닙니다(담당자 2명 · 업체 4곳 · Audit 이력, 이름 끝에 「(예제)」).
여러 담당자가 같은 자료를 함께 쓰려면 별도 서버와 데이터베이스가 필요합니다.

## 기획서 · 버전

- 사이트 「기획서」 페이지: https://build-2611-14.jobability.co.kr/plan.html — 워드 판 내려받기
- 워드 판: `docs/기획서/build-2611-14_정유석_협력업체통합품질관리_기획서_v<버전>.docx` (버전마다 남김)
- 원본: `docs/plan.json` → 생성기 `build-2611-00/tools/plandoc/make_plan.py` 로 워드·그림·plan.html·CHANGELOG.md 를 다시 만든다
- 버전을 올릴 때: `plan.json` 의 `version` 을 바꾸고 `versions` 맨 앞에 바뀐 점을 적은 뒤 생성기를 다시 돌린다
