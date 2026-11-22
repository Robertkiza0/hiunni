# 추가로 반드시 받아야 할 원본 / 접근 자료

**개발자에게 전달할 운영 데이터나 보안 비밀값은 ZIP에 넣지 않습니다.** 계정 소유자가 공식 계정의 역할 기반 권한으로 부여해야 합니다.

- [ ] 발주자의 외부 재위탁·기밀 원본 공유 서면 동의 및 필요한 경우 개인정보 처리 재위탁 승인/NDA
- [ ] `HIUNNI_v541_Development.zip`의 확인 가능한 운영 원본 또는 발주자 운영 저장소 접근과 배포 SHA
- [ ] 실제 운영 `dist/`, `worker/`, `drizzle/`, D1 schema·migrations 및 기존 1,881개 자동 테스트
- [ ] Cloudflare Workers/R2/D1/DO/Queue 계정 소유자 권한, 현재 배포 라우트·도메인 설정
- [ ] 백업·복구 담당/로그/비용/서비스 일시중단 승인·스테이징 URL 및 샘플 계정
- [ ] PortOne/KCP 및 Google/Naver OAuth의 **공식 관리 계정 설정**(비밀키 ZIP 전달 금지)
- [ ] FCM/APNs·Firebase·Apple Developer/App Store Connect/Google Play Console·서명 권한
- [ ] 기존 Android TWA 업로드 키/키 관리 담당과 앱 ID, iOS Bundle ID/Team ID·빌드 이력
- [ ] 디자인 승인본 Figma, 로고/아이콘/이미지 사용권·콘텐츠/개인정보/UGC 운영정책
- [ ] 기존 계약 실제 서명본·착수일/완료일/대금·재위탁 변경 합의 및 발주자 검수 담당자
- [ ] 실패한 원격 CI job 로그·개발자 실제 로컬 환경·테스트 시나리오

원본을 받기 전에는 **합성 데이터만** 사용하고, 운영 DB 복사/수정, 실회원 채팅·게시글 작성, iOS/Android 출시를 하지 않습니다.
