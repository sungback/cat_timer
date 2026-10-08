# CatTimer 앱 계획

방향: 빌드 없는 단일 `index.html` (브라우저, 설치 불필요). 필요해질 때만 Electron 등으로 확장.

## 동작 정의 (CatTimer.pptx 기준)
- PPT는 사진 위 도형 15개가 1분(59초 wipe)씩 차례로 사라지는 구조 → 앱도 "분당 1칸"이 줄어드는 시각화로 재현.
- 총 시간 N분이면 N칸. 칸 하나가 1분 동안 줄어든 뒤 다음 칸으로.

## 체크리스트
- [x] 1. 뼈대: 전체 화면 사진 + 칸 N개 + 시작/일시정지/리셋 (index.html 1개)
- [x] 2. 시간 엔진: `Date.now()` 종료시각 기준으로 남은 시간 계산 (setInterval 누적 금지, 탭 백그라운드에서도 정확)
- [x] 3. 시간 설정: 1~15분 버튼 + 직접 입력(분), 마지막 값 localStorage 기억
- [x] 4. 사진: 폴더 선택(`<input webkitdirectory>`) → 이미지 목록, 고르기/랜덤/슬라이드 순환 중 택1
- [x] 5. 전체 화면: Fullscreen API (창을 놓은 모니터에서 전체화면 → 다중 모니터 문제 회피), F 키 토글
- [x] 6. 종료 처리: 0 도달 시 알림음 + 화면 점멸 (Web Audio, 파일 불필요)
- [x] 7. 화면 꺼짐 방지: Screen Wake Lock API
- [x] 8. 단축키: Space 시작/정지, R 리셋, ←/→ 사진 변경, 1~9 시간 프리셋
- [ ] 9. 실제 사용 테스트: 1분 / 15분 / 2개 모니터에서 전체화면

## 미정 (사용자 결정 필요)
- [x] 사진 폴더: 기본 `./photos/` (python http.server 목록), 안 되면 폴더 선택 버튼
- [x] 줄어드는 모양: 칸 wipe
- [x] 숫자(남은 시간) 표시: 함
- [x] 실행 환경: 브라우저 먼저, 애매하면 .app/.exe

## 앱 포장 (Electron)
- [x] A. `package.json` + `main.js`(창 생성, 전체화면) — index.html 그대로 사용
- [x] B. 사진 폴더: 앱 옆 `photos/`를 `fs.readdirSync`로 읽기 (서버 불필요), 목록 전달만 수정
- [x] C. `npm start`로 실행 확인
- [x] D-mac. `npm run build:mac` → dist/mac-arm64/CatTimer.app (photos는 Contents/Resources/photos에 동봉)
- [ ] D-win. .exe 빌드 (Windows PC/CI에서 권장)
- [x] 서명 없이 재빌드(identity null) + ad-hoc 서명, .gitignore 추가 (photos/는 포함하기로 함, *.pptx는 제외)
- [ ] F. .app 실행 확인 (사진 표시, 다른 Mac 배포 시 공증 필요)

- [ ] E. 실제 창으로 눈으로 확인 (칸 wipe, 전체화면, 알림음, 2번째 모니터)

## 나중에 (YAGNI, 필요할 때만)
- 다중 모니터에서 특정 모니터 지정 전체화면 (Window Management API)
- 설정 파일/테마, 소리 파일 교체
