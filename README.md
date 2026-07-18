# 베드로 키우기 | 갈릴리 마당

수련회에서 25개 조가 꾸민 베드로를 촬영하고, 학생 그림의 색과 무늬를 유지한
게임 캐릭터 스프라이트로 변환해 프로그램 사이마다 강당 메인 화면에 보여주는
자동 전시 웹앱입니다. 기본 화면은 단순한 갈릴리 게임 무대 위에 5~6명만 크게
보여주며, 기존 3D 월드는 별도 주소에 보존되어 있습니다.

## 현재 구현된 기능

- 16:9 벡터 셀 셰이딩 스타일의 `갈릴리 마당`
- 앞뒤 두 줄의 예약 위치 8개 중 6개를 사용해 캐릭터 겹침 방지
- 12초마다 한 명씩 교대하고 25개 조가 모두 나온 뒤에만 다시 섞는 공정 순환
- 촬영 사진을 고정 베드로 마스크로 정렬·배경 제거한 뒤 OpenAI로 게임 캐릭터화
- 한 번의 생성으로 대기·교차 걷기·손 흔들기 4×3 스프라이트 시트 제작
- 시트 각 칸의 가장자리와 연결된 단색 배경만 투명화해 흰 옷과 피부색 보존
- 사진 하단의 학생 제작 닉네임창 자동 추출과 조 이름 대체 표시
- 관리자 화면에서 조별 촬영 사진 등록, AI 생성 상태 확인, 결과 시트 검수
- AI 결과가 아직 없거나 생성에 실패한 조는 기존 종이인형 표현으로 안전하게 대체
- `/world-3d`에 보존된 갈릴리 호숫가 Three.js 월드
- 25명의 베드로 배치 및 구역별 걷기
- 베드로 터치 또는 `우리 조 찾기`를 통한 조 선택
- 4축 성품 차트, 달란트, 레벨, 칭호, 성장 기록
- 45초 미조작 시 키오스크 자동 초기화
- 로컬 SQLite / 배포 Neon Postgres 기반 25개 조 데이터 영구 저장
- 운영진용 조 정보·달란트·성품 관리 화면
- 조와 독립된 PNG/JPG 모델 생성 보관함과 최대 3개 동시 변환 워커
- 기존에 보유한 애니메이션 GLB를 모델 보관함에 직접 등록
- 완성된 GLB 하나를 선택한 여러 조 또는 전체 25조에 재사용
- Tripo 이미지→3D→무료 리깅 검사→Biped 리깅→걷기 GLB 파이프라인
- 변환 실패 원인과 작업 상태 저장

실제 GLB가 없는 조는 가벼운 데모 캐릭터로 표시되며, 변환이 완료되면 월드가
서버 상태를 확인하여 실제 모델을 자동으로 불러옵니다.

## 기술 구성

- 프론트엔드: React 19, TypeScript, Vite
- 메인 전시: CSS GPU 변환, Canvas 전처리, 4×3 스프라이트 애니메이션
- 3D 월드: Three.js 0.170.0, React Three Fiber, Drei
- 물리: React Three Rapier
- 화면 효과: React Three Postprocessing(Bloom, Vignette)
- 백엔드: FastAPI, SQLite(로컬), Neon Postgres(Vercel)
- 파일 저장: 로컬 디렉터리(개발), Vercel Blob(배포)
- 배포 방식: Vite 빌드를 FastAPI가 같은 주소에서 제공

Three.js와 R3F 관련 라이브러리는 프론트엔드 번들에 포함되므로 CDN 연결 없이
로드됩니다. 조 데이터, 업로드 이미지, GLB 경로와 기존 API 형식은 React 전환
전과 동일하게 유지합니다. Rapier가 캐릭터·모닥불·의자·배·돌·덤불과 섬 경계의
충돌을 처리하고, 캐릭터의 배회 방향과 속도는 React 프레임 루프가 제어합니다.

## 설치 및 실행

Python 3.9 이상과 Node.js 20.17 이상이 필요합니다. 이 프로젝트는
`.nvmrc`로 Node.js 24.12.0 LTS를 사용합니다.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# .env의 OPENAI_API_KEY와 TRIPO_API_KEY를 각 서비스의 비밀키로 교체

cd frontend
npm ci
npm run build
cd ..

uvicorn backend_main:app --env-file .env --host 0.0.0.0 --port 8000
```

`.env`는 Git에서 제외됩니다. 실제 키는 백엔드에서만 읽으며, `VITE_` 접두사가
붙은 환경 변수나 프론트엔드 코드에 넣지 마세요.

- 강당 메인 전시: `http://localhost:8000/`
- 기존 3D 월드: `http://localhost:8000/world-3d`
- 운영진 관리: `http://localhost:8000/admin`
- 20프레임 애니메이션 실험실: `http://localhost:8000/sprite-lab`
- 서버 상태: `http://localhost:8000/api/health`

행사 운영 컴퓨터에서 메인 전시 주소를 크롬 전체 화면으로 열고 프로젝터 또는
LED 화면에 출력합니다. 전시 화면에는 버튼이나 스탯 패널이 없으며 자동으로
계속 재생됩니다.

### 프론트엔드 개발 모드

백엔드를 8000번 포트로 실행한 상태에서 다른 터미널을 엽니다.

```bash
cd frontend
npm run dev
```

개발 전시 화면은 `http://localhost:5173/`, 관리 화면은
`http://localhost:5173/admin`, 기존 3D 화면은
`http://localhost:5173/world-3d`에서 확인합니다. Vite가 `/api`, `/static`,
`/uploads` 요청을 FastAPI로 전달합니다. 행사에서는 개발 서버 대신 미리
`npm run build`한 뒤 FastAPI만 실행하세요.

## 20프레임 스프라이트 애니메이션 실험실

`/sprite-lab`은 5×4 스프라이트 시트에서 추출한 개별 프레임으로 상태 전환과
실제 이동을 검증하는 개발용 화면입니다. 기존 자동 전시와 3D 월드는 그대로
두고, 새로운 학생 캐릭터의 프레임·속도·발 기준선을 조정할 때 사용합니다.

- 정지, 걷기, 뛰기, 손 흔들기, 점프, 기도, 무릎 꿇기, 가리키기
- 걷기와 뛰기에 맞춘 실제 좌우 이동과 방향 반전
- 화면 밖 입장과 퇴장
- 아침·밤 갈릴리 배경 전환
- 같은 프레임 구조를 사용하는 5명의 순차 등장 시연
- 탭 비활성화 또는 화면 밖 캐릭터의 프레임 업데이트 일시 정지
- `prefers-reduced-motion` 환경의 축소된 이동과 모션

개발 컨트롤은 기본으로 표시됩니다. 발표 화면처럼 캐릭터만 확인하려면 다음
주소를 사용합니다.

```text
http://localhost:8000/sprite-lab?controls=false
```

키보드 `C`를 누르면 컨트롤을 다시 열거나 숨길 수 있습니다. 크롬 전체 화면은
macOS에서 `Control + Command + F`, Windows에서 `F11`로 전환합니다.

### 현재 이미지 분석 결과

제공된 원본은 1402×1122 RGB PNG입니다. 실제 알파 채널이 없고, 밝은 회색
체크보드가 이미지 픽셀로 포함되어 있습니다. 5열×4행이며 각 행은 다음과 같이
사용합니다.

1. 정면·3/4·측면·후면 기본 자세
2. 걷기 5프레임
3. 뛰기 5프레임
4. 손 흔들기·점프·기도·무릎 꿇기·가리키기

셀 크기는 거의 일정하지만 실제 캐릭터 바운딩 박스와 발바닥 위치는 포즈마다
달라 원본 전체를 CSS 격자로 재생하면 캐릭터가 흔들립니다. 전처리 스크립트는
각 좌표를 잘라 공통 투명 캔버스에 놓고 발 기준선을 맞춥니다. 얼굴, 구름 무늬,
하트 허리띠와 신발은 비교적 일관되지만 점프·기도·무릎 꿇기처럼 몸 높이가
달라지는 포즈는 `scripts/sprite_regions.json`에서 개별 보정할 수 있습니다.

### 프레임 추출

```bash
.venv/bin/python scripts/extract_sprites.py \
  --input frontend/public/assets/peter/peter-sprite-sheet.png \
  --config scripts/sprite_regions.json \
  --output frontend/public/assets/peter/frames \
  --overwrite
```

원본 체크보드는 실제 투명도가 아니므로 전처리 설정에 명시된 보수적인
가장자리 연결 배경 제거를 사용합니다. 스크립트가 체크보드를 감지하면 경고를
출력합니다. 흰 셔츠 내부처럼 배경과 비슷하지만 가장자리와 연결되지 않은 영역은
유지합니다. 결과가 과하게 지워지면 JSON의 배경 임계값을 낮추고 다시 실행하세요.

좌표를 수정할 때는 `scripts/sprite_regions.json`의 해당 프레임 `x`, `y`,
`width`, `height`만 고칩니다. 캐릭터 크기는 `scale`, 좌우 위치는 `anchorX`,
발 위치는 `anchorY` 또는 공통 `baselineY`로 조정합니다. Python 코드를 수정할
필요는 없습니다.

### 애니메이션과 학생 캐릭터 추가

웹 애니메이션 정의는 `frontend/src/spriteLab/data.ts`에 있습니다. `fps`를
바꾸면 걷기·뛰기 속도를 조정할 수 있고, `frames` 배열에 같은 파일명 규칙의
PNG를 추가하면 프레임 수를 늘릴 수 있습니다. 상태 충돌 규칙은
`frontend/src/spriteLab/stateMachine.ts`에 분리되어 있습니다. 프레임 시간
계산과 탭 일시정지는 `useSpriteAnimation.ts`, 실제 화면 이동은
`useCharacterMovement.ts`가 담당하므로 학생별 컴포넌트를 새로 만들 필요가
없습니다.

새 학생 캐릭터는 다음 순서로 추가합니다.

1. `frontend/public/assets/characters/{조}/{캐릭터}/source.png`에 시트 저장
2. `sprite_regions.json`을 복사하고 좌표를 보정
3. 전처리 스크립트로 해당 캐릭터의 `frames/` 생성
4. `data.ts`에 이름, 조, 애니메이션 프레임 루트 등록
5. `demoCharacters` 또는 별도 시퀀스 데이터에 등장 순서 추가

모든 학생 캐릭터가 `idle-front.png`, `walk-01.png`, `run-01.png`,
`wave-01.png`와 같은 파일명을 사용하면 컴포넌트 코드를 새로 작성할 필요가
없습니다. 조별 등장 순서는 `demoCharacters`와 `demoSlots` 데이터만 바꾸면
됩니다. 한 화면의 최대 인원과 입장·이름표 시간은 `demoSequenceSettings`의
`maxVisible`, `entranceDelayMs`, `nameVisibleMs`로 조정합니다.

갈릴리 배경은 현재 `sprite-lab.css`의 CSS 레이어로 구성되어 있습니다. 실제
아침·밤 배경 이미지가 준비되면
`frontend/public/assets/backgrounds/galilee-morning.png`와
`galilee-night.png`에 저장하고 `.sprite-stage` 배경 토큰만 교체하면 됩니다.

현재 시트의 1회성 행동은 포즈별 한 장만 있으므로 손 흔들기·기도 동작 자체는
짧은 몸 움직임과 함께 표시됩니다. 각 행동을 더 자연스럽게 만들려면 동일한
캔버스와 발 기준선으로 2~4개의 추가 프레임을 제작하는 것이 가장 효과적입니다.

## 2D 촬영과 AI 캐릭터 생성

1. 관리자 화면의 `2:3 촬영판 가이드 열기`를 열어 같은 비율로 인쇄합니다.
2. 베드로 머리 꼭대기를 상단 약 10%, 발끝을 약 79% 기준선에 맞춥니다.
3. 닉네임창은 촬영판 하단의 가로 16~84%, 세로 81~97% 영역에 놓습니다.
4. 네 모서리의 빨강·파랑·초록·노랑 기준점이 모두 나오도록 촬영합니다.
5. `/admin`에서 조를 선택한 뒤 `학생 그림 등록`에 완성 사진 한 장을 등록합니다.
6. 사진이 올바르게 분리되었는지 확인한 뒤 `AI로 12컷 생성`을 누릅니다.
7. 생성된 4×3 결과 시트를 열어 색, 옷 무늬, 팔다리 교차 동작을 검수합니다.

브라우저는 네 기준점으로 기울기와 원근을 자동 보정한 뒤 공통 크기로 정렬하고,
고정 실루엣으로 캐릭터를 잘라 OpenAI 이미지 편집 API에 전달합니다. AI에는
닉네임창이 아닌 캐릭터만 전달하며, 대기 4컷, 오른쪽 걷기 4컷, 손 흔들기 4컷을
한 장에 생성합니다. 생성 버튼을 누를 때마다 유료 API 사용량이 발생하므로
결과가 필요한 조만 한 번씩 처리하고 실패한 조만 재시도하세요.
사진 하단에 실제 닉네임창 그림이 감지되면 그 이미지를 그대로 사용하고, 감지되지
않으면 조 이름을 게임 명찰 형태로 표시합니다. 촬영 위치가 크게 벗어나면
캐릭터 경계가 어긋날 수 있으므로 실제 제작물 3장 이상으로 사전 리허설하세요.
2D 전시 사진은 `showcase_image_url`에 따로 저장되므로 기존 3D 변환 원본과
완성 GLB의 연결은 변경되지 않습니다. AI 시트는 `showcase_sprite_url`에 별도로
저장되며 새 촬영 사진을 등록할 때만 기존 AI 시트 연결이 초기화됩니다.

## Tripo 변환 설정

기본값은 비용과 현장 안정성을 고려해 다음과 같습니다.

- 입력 이미지 자동 보정(`enable_image_autofix=true`)
- 기본 프로필: H3.1 `v3.1-20260211` 40,000면 일반 메시
- 비교 프로필: P1 `P1-20260311`(API 상한에 맞춰 최대 20,000면)
- 관리자 화면에서 대표 그림 2~3건만 프로필을 바꿔 비교
- 표준 텍스처, 원본 이미지 색상 정렬, PBR 제외, 압축 출력
- 생성 메시 목표 40,000면 (`TRIPO_FACE_LIMIT`으로 변경 가능)
- 무료 `check_riggable` 선행
- Rig `v1.0-20240301` 사람형 Biped 리깅
- Biped 전용 `standing_relax`와 `walk`를 GLB 하나에 적용
- 제자리 대기·걷기 GLB 생성
- 단일 이미지가 리깅 불가일 때만 멀티뷰 생성·모델링을 1회 시도
- 동시 변환 3개 (`PETER3D_WORKERS=1..5`로 변경)
- 완성 GLB 검수: 리깅·애니메이션 2개 필수, 최대 10MB·100,000 삼각형
- 관리자 화면에 잔여·보류 크레딧과 작업별 실제 소모량 표시

기본 H3 Smart 프로필은 약 85크레딧, P1은 약 95크레딧이 예상됩니다.
멀티뷰 폴백이 실행되면 추가 크레딧이 사용되며, 실제 금액은 Tripo 작업
응답의 `consumed_credit`를 저장해 관리자 화면에 표시합니다.

## 기존 3D 월드 성능 정책

- iPad/터치 기기는 `balanced` 프로필을 자동 적용합니다.
- GLB 다운로드·파싱은 iPad에서 2개, 고성능 기기에서 3개까지만 동시에 진행합니다.
- 아직 대기 중인 조는 준비 화면 뒤에서 저비용 데모 캐릭터 상태를 유지합니다.
- 선택한 조의 대기 모델을 우선 로드하고, 선택 중에는 이동을 멈춘 채 idle 애니메이션을 재생합니다.
- 걷기 애니메이션은 iPad 15fps, 고성능 기기 30fps로 갱신합니다.
- 배회 판단은 iPad 10fps, 고성능 기기 15fps로 낮추되 Rapier 이동은 계속 보간합니다.
- iPad에서는 30Hz 고정 물리, 낮은 DPR, 그림자·후처리 비활성화로 발열을 줄입니다.
- Draco 디코더는 빌드에 함께 복사되어 외부 CDN 없이 압축 GLB를 읽습니다.

생성 목표는 조당 4~8MB, 40,000면 이하입니다. 서버의 10MB·100,000
삼각형 제한은 비정상 결과의 배포를 막는 안전 상한이며, 이 상한에 가까운 모델
25개를 동시에 쓰는 것을 권장한다는 의미는 아닙니다.

25조 전체를 변환하기 전 대표 그림 2~3장으로 리깅 성공률과 실제 크레딧을
반드시 확인하세요. 변환은 외부 API 비용을 사용합니다.

## 운영 흐름

1. `/admin`에서 조 이름과 기본 정보를 입력
2. 촬영판에 베드로와 닉네임창을 놓고 조별 완성 사진 한 장 촬영
3. 조를 선택해 `2D 캐릭터 사진`에 등록
4. 메인 전시에서 실루엣·파츠 경계·닉네임창이 맞는지 확인
5. 25개 조를 모두 등록한 뒤 크롬 전체 화면으로 10분 이상 리허설
6. 필요한 경우에만 기존 3D 보관함에서 GLB 생성·등록·배정

## 데이터와 생성 파일

- SQLite: `data/peter3d.db`
- 2D 원본 업로드와 3D 변환 원본: `uploads/`
- 완성 GLB: `static/models/asset-{작업 ID}/` (새 공용 생성 흐름)
- 직접 등록 GLB: `static/models/model-assets/{모델 ID}/model.glb` (로컬 개발)
- React 소스: `frontend/src/`
- 생성된 프론트엔드 빌드: `frontend/dist/`

SQLite, 업로드, 완성 GLB와 생성된 빌드는 Git에서 제외됩니다. 행사 전에는
`data/`, `uploads/`, `static/models/`을 별도 저장장치에 백업하고, 행사 종료 후
학생 그림의 보관·삭제 방침에 따라 정리하세요.

### Vercel 영구 저장소

배포 환경에서는 서버리스 함수의 임시 디스크에 의존하지 않습니다.

- 조 정보·성품·달란트·성장 기록·변환 작업·모델 보관함·조 배정: Neon Postgres
- 원본 PNG/JPG, AI 스프라이트 PNG와 완성 GLB: Vercel Blob
- 임시 Tripo 업로드 파일: 함수 실행 중에만 `/tmp` 사용 후 즉시 삭제

Vercel Function의 요청 본문 제한을 넘지 않도록 운영 화면은 3.8MB보다 큰 사진을
긴 변 2048px 이하의 JPG로 자동 최적화한 뒤 전송합니다. 원본 그림을 별도로
보관해야 한다면 촬영 기기에도 원본을 남겨두세요.

Vercel 프로젝트에는 `DATABASE_URL`(또는 `POSTGRES_URL`),
`BLOB_READ_WRITE_TOKEN`, `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`,
`TRIPO_API_KEY`, `TRIPO_PIPELINE_PROFILE`이 설정되어야 합니다. 비밀값은
`.env`, `.env.local` 또는 Vercel 환경 변수에만 두고 저장소에 커밋하지 마세요.
`/api/health`의 `persistent_storage`가 `true`이고 `openai_configured`가
`true`이면 저장소와 AI 캐릭터 생성 연결이 준비된 상태입니다.

기존 SQLite 데이터를 이관할 때는 먼저 해당 이미지와 GLB를 Blob의
`teams/{조}/images/migrated.*`, `teams/{조}/models/migrated.glb` 경로에 올린 뒤
다음을 한 번 실행합니다. 스크립트는 같은 데이터로 재실행해도 안전합니다.

```bash
set -a
source .env.local
set +a
.venv/bin/python scripts/migrate_sqlite_to_postgres.py \
  --blob-base-url https://YOUR_STORE.public.blob.vercel-storage.com
```

## 현장 배포 전 확인

- 실제 촬영 사진 3장 이상으로 고정 마스크, 닉네임창, AI 시트 품질 확인
- 1920×1080 프로젝터에서 뒤쪽 좌석의 옷 무늬·닉네임 가독성 확인
- 25개 조를 등록한 상태로 크롬 전체 화면 10분 이상 자동 순환 확인
- Google Fonts를 로컬 글꼴로 교체해 완전 오프라인화
- 흰색 옷, 밝은 피부, 연한 무늬가 배경 투명화 뒤 유지되는지 확인
- 실제 Tripo 변환 2~3건 통합 테스트
- 실제 iPad에서 25개 애니메이션 GLB를 넣은 10분 발열·프레임률 측정
- 운영진 수정 API에 PIN 또는 관리자 인증 적용
- 발표용 조별 자동 순회 연출
- 사진 촬영 가이드 및 변환 결과 승인/재시도 UX 강화
