# 하이언니 FlutterFlow iOS 개발·컨펌 보고서

**2026년 11월 19일** · 원본 `my_app(2).zip` 별도 수정본 (FlutterFlow 온라인 프로젝트 Push 아님)

## 오늘 만든 결과물

- **수정 소스 ZIP:** `HIUNNI_FlutterFlow_iOS_Preview_20261119.zip` (238,733 bytes)
- **SHA-256:** `50c1e9c67af13915ef24fa77948e6866e15e2922aa57775707ed7d2f2c5dbf53`
- ZIP `testzip()` 무결성 검사: **통과**. 코드 컴파일/실기기 실행과는 다름.
- **원본 파일 삭제:** 0개. **원본 대비 신규·수정 파일:** 17개.

## 개선 사항

1. 로그인·회원가입 폼: 작은 iPhone 화면에서도 스크롤, 입력 즉시 검사, 비밀번호 재입력 불일치 안내.
2. 플레이스 샘플 카드: 검색어와 지역 선택을 실제 표시 목록에 연결, 검색 결과 없을 때 초기화 제공.
3. 실시간현황 샘플 채팅방: 지역/구인/텍스트 검색 결과 연결, 빈 결과 및 필터 초기화 제공.
4. 저장한 플레이스: 검색 목록 자체 필터, 빈 결과 화면, 중복 저장 방지, 기존 중복 해제 처리.
5. iOS 소스: 앱 이름 `하이언니 미리보기`, **임시 테스트용** Bundle ID `app.hiunni.flutterflow.preview`, 기존 코드 버전 `1.0.0+1`, Xcode 프로젝트와 아이콘 자산 확인.
6. Mac에서 iOS **시뮬레이터** 빌드를 재현할 수 있도록 `.github/workflows/hiunni-ios-simulator-preview.yml` 예시 및 8개 순수 로직 단위 테스트 추가. **실제로 실행한 CI는 아님**.

## 비개발자용 승인 의견

**이 단계는 소스 개선분에 한하여 조건부 승인 가능.** 정식 납품 승인이나 앱 출시 승인이 아님.

| 확인 대상 | 현재 판정 |
|---|---|
| 로그인/가입 UI·샘플 검색과 필터 코드를 수정했는가 | **예 (ZIP에 반영)** |
| 소스 ZIP 다운로드·압축 검증 가능한가 | **예 (로컬 확인)** |
| iOS 프로젝트 파일이 있는가 | **예 (Xcode용 파일 포함)** |
| 현재 FlutterFlow 온라인 원본에 Push했는가 | **아니요** |
| Flutter 테스트를 실제로 돌렸는가 | **아니요 (Flutter SDK 없음)** |
| Xcode iOS 빌드를 실제로 성공했는가 | **아니요 (macOS/Xcode 없음)** |
| IPA 파일이나 TestFlight 초대가 생겼는가 | **아니요** |
| Apple Developer / App Store Connect 연결 상태 | **확인 불가** |
| 운영 서비스 로그인·채팅·신고·차단이 연동됐는가 | **아니요** |
| 기존 운영 앱/사용자 DB 변경했는가 | **아니요** |

**이유:** 이 환경은 Linux이며 Flutter SDK/Xcode 및 Apple 서명 계정이 없다. 현재 내보낸 FlutterFlow 소스는 별도의 실제 인증/채팅 서버 연결이 없다. 폼에서 입력한 비밀번호를 실제 회원가입으로 저장하거나 로그인 성공으로 표시하지 않았다.

## 다음에 필요한 소유자 확인

- FlutterFlow 프로젝트 `my-app-mrsti7`의 오너가 수정사항을 온라인 프로젝트에도 적용·Push할지 결정.
- Apple Developer 팀 계정과 별도 테스트용 Bundle ID의 사용/등록 승인.
- FlutterFlow `Releases → App Store`에서 계정 연결. **Apple API 키·서명 자료는 채팅으로 보내지 않고 공식 설정 화면에서 등록**.
- 앱 아이콘·시작 화면을 브랜드 기준으로 최종 승인, macOS에서 `flutter pub get` → `flutter analyze` → `flutter test` → `flutter build ios --simulator --debug --no-codesign`.
- 시뮬레이터 실행/클릭 테스트가 성공하고 서명·스토어 연결이 확인된 후에만 TestFlight용 아카이브/IPA 빌드와 내부 테스터 초대.
- 미등록 앱(Unlisted)은 베타 앱 배포 방식이 아니며, 별도 App Review 및 Apple 승인이 필요하다. 이번에는 신청하지 않음.

## 수정한 파일 목록

- `my_app/IOS_BETA_STATIC_CHECK.json`
- `my_app/HIUNNI_IOS_BETA_CONFIRMATION_KO.md`
- `my_app/lib/app_state.dart`
- `my_app/lib/main.dart`
- `my_app/lib/preview_logic.dart`
- `my_app/test/preview_logic_test.dart`
- `my_app/ios/Runner/Info.plist`
- `my_app/ios/Runner.xcodeproj/project.pbxproj`
- `my_app/.github/workflows/hiunni-ios-simulator-preview.yml`
- `my_app/lib/components/option_button_widget.dart`
- `my_app/lib/pages/saved_places_page/saved_places_page_widget.dart`
- `my_app/lib/pages/home_page/home_page_widget.dart`
- `my_app/lib/pages/home_page/home_page_model.dart`
- `my_app/lib/pages/demo_access_page/demo_access_page_widget.dart`
- `my_app/lib/pages/choice_talk_page/choice_talk_page_widget.dart`
- `my_app/lib/pages/create_account_page/create_account_page_model.dart`
- `my_app/lib/pages/create_account_page/create_account_page_widget.dart`

## 산출물의 의미

이 ZIP은 **FlutterFlow 소스 내보내기의 개발 보완판**이다. 서명된 iPhone 앱 `.ipa`나 설치 가능한 앱 파일은 아니다. **검수 보고서는 정적 확인 결과**이며 실제 모바일 동작을 증명하지 않는다.
