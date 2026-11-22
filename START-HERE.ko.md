# 하이언니 앱 소스 인계

운영 웹: https://hiunni.kr/
소스 기준: 운영 웹 v541에 사용한 소스 커밋 bc9f18e
운영 웹에 연결하는 Android·iOS 앱 프로젝트, 앱 아이콘, 스토어용 스크린샷을 포함합니다.

## Android

- Android Studio에서 mobile/android 폴더를 엽니다. JDK 17과 Android SDK 36이 필요합니다.
- 이 메일용 ZIP에는 실행 파일과 Gradle Wrapper 실행 스크립트를 담지 않았습니다.
- Gradle 공식 배포처(https://gradle.org/releases/)에서 Gradle 8.13을 설치합니다. 배포 파일 검증용 SHA-256은 gradle/wrapper/gradle-wrapper.properties에 남겨두었습니다.
- mobile/android 폴더에서 설치한 Gradle로 gradle testDebugUnitTest assembleDebug를 실행합니다. Android Studio에서 열 경우 설치된 Gradle 8.13을 선택합니다.
- 기존 앱 ID: app.hiunni.mobile. 소스 버전: 1.0.1 (versionCode 4).
- 마지막 확인 기록상 Google Play 내부 테스트에 1.0.1(4)을 배포했습니다. 출시용 비공개 테스트, 스토어 설정 확인과 정식 출시 신청이 남아 있습니다.
- 정식 빌드는 기존 Play 앱의 승인된 업로드 키로 서명합니다.

## iOS

- Mac의 Xcode에서 mobile/ios/HiUnni.xcodeproj를 열고 기존 앱의 승인된 서명 팀을 선택합니다.
- 기존 Bundle ID: app.hiunni.mobile. 프로젝트 버전: 1.0.0 (build 1).
- 실기기 검수 후 Xcode Archive → Validate → App Store Connect Upload를 진행합니다.
- 마지막 확인 기록상 스토어 등록 자료는 준비됐고 빌드 업로드·심사 제출은 확인되지 않았습니다.

양쪽 모두 실제 기기에서 로그인·본인인증과 일반 심사용 계정 접근을 검수하세요.
운영 DB, 계정 로그인 정보, 서명키, 비밀번호, 환경변수 파일은 포함되지 않습니다.
Apple 서명 팀 설정은 전달본에서 비워뒀습니다.
