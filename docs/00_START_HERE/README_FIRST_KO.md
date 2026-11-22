# 하이언니 외주 개발자 인수인계 | 2026-11-19

## 읽는 순서
1. `00_START_HERE` — 본 안내와 전체 파일 목록
2. `01_Contract_And_Original_Request` — 발주자 제공 계약서·의뢰서 PDF 원본. **참고본**이며 서명·실행 여부 별도 확인
3. `02_Product_Planning` — 사용자 여정, IA, 기존 기능 보존, 제품 기획안(DOCX/PDF)
4. `03_Development_Spec` — 운영 아키텍처/소스 계보/F01~F10 구현 기준/테스트 및 배포 게이트(DOCX/PDF)
5. `04_Design_And_References` — 12장 디자인 PPT, UI 가이드, 모바일/PC 캡처, 별도 웹 데모 HTML
6. `05_Source_Code` — 실제 확보한 앱/FlutterFlow/웹/SQL 후보 ZIP **원본**과 소스 대응표
7. `06_Progress_QA` — 현황·QA/기능별 계약 체크리스트와 CSV
8. `07_Developer_Onboarding` — 새 개발자 업무지시·영문 가이드·보고 템플릿·보낼 메시지
9. `08_Security_And_Handoff` — 미확보된 운영 원본/서면 승인/권한/개인정보 주의
10. `09_Links_And_References` — 시연·저장소·레퍼런스 링크

## 가장 중요한 결론
- **구현된 것**: 시연용 다크퍼플 웹 UIUX 및 synthetic 데이터 인터랙션; Flutter 달이/다크퍼플 수정 코드 후보; FlutterFlow export; 후보 SQL 001–016/로컬 검증 기록.
- **아직 최종 완료라고 볼 수 없는 것**: 운영 v541 전체 코드 동일성·기존 DB/회원 데이터 이관, 운영 OAuth/인증, R2 이전, 실시간 2기기 채팅, DM 사진/권한, FCM/APNs, iOS IPA/TestFlight 및 Android/iOS 정식출시, 발주자 검수.
- **앱 개발 시작점**: `05_Source_Code/HIUNNI_Midnight_Cat_Integrated_20261119.zip` 내부 `hiunni-product/flutter-app/`를 먼저 검사. 운영 코드 대체 확정은 금지.
- **운영 원본 요청**: `08_Security_And_Handoff/REQUIRED_MISSING_ORIGINALS.md`.
- **DB 주의**: 최신 SQL v2 샘플 67테이블 및 001–016 migration은 운영 D1 schema와 매칭 전 사용 금지.

## 법률·보안
계약 제12조·13조의 재위탁/개인정보 제한에 따라, 신규 개발자에게 보내는 공유 행위는 발주자 동의·NDA·접근권한 확인 후 진행. 이 패키지는 **실회원 DB, 계정 비밀번호, 운영 토큰을 포함하지 않도록 구성**. 서명본 계약이나 추가 합의를 대신하지 않음.

## URL
- 웹 데모 v2: https://hiunni-midnight-uiux-v2-20261119.vercel.app/
- 1차 웹 데모: https://hiunni-midnight-ui-preview-20261119.vercel.app/
- private GitHub: https://github.com/heismadepeter0191-ops/webuilding
- 운영: https://hiunni.kr/
