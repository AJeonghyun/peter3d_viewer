# 수련회 디스플레이 스튜디오 · 베드로 키우기

개발자가 아닌 수련회 운영자가 21개 조 정보와 캐릭터를 직접 등록하고, 조 배치·
안내·전체 캐릭터 화면을 실시간으로 편집해 1920×1080 프로젝터로 송출하는
React + TypeScript 웹앱입니다. 수련회 디스플레이 기능은 브라우저 로컬
저장소만으로도 동작합니다.

## 수련회 화면 빠른 시작

```bash
cd frontend
npm install
npm run dev
```

프로덕션 빌드는 `npm run typecheck && npm run build`로 확인합니다.

| 용도 | 경로 |
| --- | --- |
| 운영자 편집기 | `/editor` |
| 예수님과 베드로 정면 라인업 송출 | `/display/stand` |
| 예수님과 베드로 뒷모습 라인업 송출 | `/display/back` |
| 갈릴리 모닥불 송출 | `/display/campfire` |
| AI 캐릭터·조 정보 관리 | `/admin` |

송출 경로에는 편집 버튼이 표시되지 않습니다. 운영자는 `/editor` 왼쪽 패널에서
화면을 고르고 오른쪽 16:9 미리보기로 즉시 확인한 뒤 `송출 화면 열기`를 누르면
됩니다. 브라우저 전체 화면은 편집기의 `전체 화면` 버튼이나 Windows `F11`,
macOS `Control + Command + F`로 실행합니다.

### OBS 투명 배경 송출

`/editor`의 `OBS 투명 배경`에서 `모든 송출 페이지 배경 투명`을 켜면
미리보기와 `송출 화면 열기`에 투명 배경이 적용됩니다. OBS Browser Source는
편집기에서 페이지별 `OBS URL 복사` 버튼으로 복사하거나 다음 주소를 직접
사용합니다.

| 화면 | OBS Browser Source URL |
| --- | --- |
| 정면 라인업 | `/display/stand?obs=1` |
| 뒷모습 라인업 | `/display/back?obs=1` |
| 갈릴리 모닥불 | `/display/campfire?obs=1` |
| 전체 자리표 | `/display/seating?obs=1` |
| 시상식 | `/display/awards?obs=1` |

`?obs=1`은 다른 브라우저의 저장 설정과 관계없이 실제 알파 투명 배경을
강제합니다. `?background=transparent`도 같은 방식으로 사용할 수 있으며,
쿼리가 없는 일반 송출 URL은 기존 배경을 유지합니다. OBS에서는 브라우저 소스
크기를 `1920 × 1080`, 사용자 지정 CSS를 비워 둔 상태로 사용하면 됩니다.

## 21개 조 데이터와 스프라이트

편집기의 `21개 조 데이터`에서 1조부터 21조까지 다음 정보를 관리합니다.

- 조 이름, 표시 이름, 담당 교사·리더, 조원 이름
- 캐릭터 표시 여부, 크기, 강조색, 기본 애니메이션
- 조별 스프라이트 이미지와 프레임 JSON

`스프라이트 업로드`로 PNG/JPG/WebP를 선택하면 원본 Blob은 IndexedDB에
저장되어 새로고침 후에도 유지됩니다. 작은 설정과 텍스트는 localStorage에
자동 저장됩니다. 가로형 스프라이트 시트는 다음 JSON 구조를 사용합니다.

```json
{
  "frameCount": 6,
  "frameWidth": 160,
  "frameHeight": 192,
  "fps": 8
}
```

프레임 JSON이 없으면 업로드 이미지를 한 장의 대표 포즈로 표시합니다. 새
캐릭터를 추가할 때는 해당 조를 선택해 이미지와 JSON을 등록하면 되며, 별도
React 컴포넌트를 만들 필요가 없습니다. 모든 조는 공통 `RetreatCharacter`와
`SpriteAnimator`를 사용합니다.

### 고정 베드로 의상 합성 테스트

`/garment-test`는 고정된 5×5 베드로 마스터의 얼굴·수염·체형·동작을 유지한
채 학생 그림의 상의와 하의만 합성하는 검수 화면입니다. 포함된 샘플은 파도·별
상의와 물고기 하의를 추출해 25개 포즈에 적용하며, PAGE 3의 1조가 같은
걷기·달리기·동작 시트를 사용합니다.

샘플 결과는 다음 명령으로 다시 만들 수 있습니다.

```bash
python3 scripts/apply_garment_design.py \
  --master frontend/public/assets/peter-garment-demo/peter-master.png \
  --design frontend/public/assets/peter-garment-demo/source/student-garment-sample.png \
  --output frontend/public/assets/peter-garment-demo
```

입력 디자인 카드는 밝은 종이 위 위쪽 절반에 상의, 아래쪽 절반에 하의를
배치합니다. 스크립트는 색칠된 내부 영역을 텍스처로 추출하고, 갈색 허리띠와
의상 밖의 모든 픽셀 및 마스터 알파 실루엣을 보존합니다. 실제 학생 촬영본을
운영에 연결할 때는 AI가 먼저 촬영본을 이 상·하의 카드 규격으로 정규화하고,
승인된 결과만 동일한 결정적 합성 단계에 전달해야 합니다.

## 페이지별 사용법

### 정면·뒷모습 라인업 · 갈릴리 모닥불

세 장면은 활성화된 최대 21개 조를 `1–7조`, `8–14조`, `15–21조`로 나눠
7개 조씩 14초 간격으로 순환합니다. `/display/stand`는 예수님과 해당 회차의
베드로가 정면을 보고 서며 몇 초마다 무작위로 한 명이 손을 흔듭니다.
`/display/back`은 같은 크기와 배치로 예수님까지 모두 뒷모습을 보여줍니다.
`갈릴리 모닥불`도 해당 회차의 7개 조가 예수님과 모닥불 둘레에 앉습니다.
캐릭터 아래 조 이름표는 표시하지 않습니다.

각 장면의 캐릭터·예수님·모닥불은 `/editor/stand`, `/editor/back`,
`/editor/campfire`의 왼쪽 오브젝트 패널에서 PPT 요소처럼 추가하거나 뺄 수
있습니다. 세 편집 페이지 모두 정면·뒷면·착석 포즈와 `서 있기·숨쉬기`,
`손 흔들기` 애니메이션 전체를 고를 수 있고, 캔버스에서는 드래그와 `작게/크게`,
`좌우 반전(F)`으로 배치합니다. 각 편집 페이지에서 PNG/JPG/WEBP/GIF를 장면
오브젝트로 여러 개 추가해 캐릭터와 똑같이 이동·확대·숨김·삭제할 수 있습니다.
오브젝트 파일은 개발 환경에서는 `uploads/`, 배포 환경에서는 Vercel Blob에
저장하고, 목록·표시 여부·포즈·배치는 SQLite 또는 Neon DB에 장면별로 자동
저장합니다. 다른 기기의 송출 페이지는 2.5초마다 변경 상태를 받아오므로 열린
화면에도 추가·이동·삭제가 자동 반영됩니다. 기존 브라우저 저장 데이터는 서버에
장면 데이터가 아직 없을 때 편집 페이지 최초 접속 시 한 번 이전됩니다.
기본 배치와 상수는 `frontend/src/pages/AllCharactersPage.tsx`, 포즈 목록은
`frontend/src/retreat/scenePoses.ts`에서 수정합니다.

### 시상식 트로피 오버레이

`/display/awards`는 외부 PowerPoint 화면 위에 합성할 수 있도록 배경을 완전히
투명하게 유지하며, 회전하는 트로피 하나만 표시합니다. 무대·문구·조 캐릭터와
이미지/GIF 오브젝트는 송출하지 않습니다. `/editor/awards`에서는 트로피의
위치·크기·각도·회전 속도만 조절하고, 참조 슬라이드는 편집 캔버스에서만
확인할 수 있습니다.

각 배치 편집기의 왼쪽 패널은 `사이드바 닫기`로 접어 가려진 캔버스를 편집하고
같은 위치의 `사이드바 열기`로 다시 펼칠 수 있습니다. 송출·편집 장면의 자체
배경은 투명하며, 편집할 때만 왼쪽 패널의
`참조 슬라이드`에서 PNG/JPG/WEBP/GIF를 첨부하거나 PowerPoint에서 슬라이드를
복사한 뒤 `⌘V`로 붙여넣어 캐릭터 위치를 맞출 수 있습니다. 참조 이미지는
장면별 IndexedDB에 저장되고 새로고침하면 기본적으로 숨겨집니다. `참조 보기`와
`참조 숨기기`로 편집 중에만 전환할 수 있으며 실제 송출 화면에는 나타나지 않습니다.
참조 슬라이드는 작업용이라 기기 간 공유하지 않고, 실제 장면에 추가한 이미지/GIF
오브젝트만 서버를 통해 공유합니다.

송출 장면은 `frontend/public/assets/retreat/peter-retreat-master.png`의 7개 포즈만
사용합니다. 조별 의상 생성·검수 호환을 위한 25프레임 원본 계약은 백엔드에
그대로 유지되므로 기존 승인 캐릭터도 계속 사용할 수 있습니다.

## 이미지 저장, 백업과 복구

편집기 상단에서 PNG 또는 JPG를 선택하고 `이미지 저장`을 누르면 현재 페이지를
1920×1080으로 저장합니다. 현재 프레임, 정지 프레임, 균형 배치 캡처 모드를
선택할 수 있습니다. 정지 캡처는 애니메이션을 잠시 멈추고 이미지·폰트 로딩을
기다린 뒤 저장하며 완료 후 재생 상태를 복원합니다. 로컬 업로드 이미지를
사용하므로 외부 CORS 이미지로 인한 canvas 오염을 피합니다.

`설정 백업`은 전체 텍스트와 조 메타데이터를 JSON으로 내려받고, `설정 불러오기`
는 해당 JSON을 복구합니다. 이미지 Blob은 브라우저 IndexedDB에 별도로 남아
같은 기기·브라우저에서 연결됩니다. `설정 초기화`는 확인 대화상자를 거친 뒤
기본값으로 되돌립니다.

## 성능과 접근성

- 21개 캐릭터의 물리는 하나의 Matter.js 엔진과 requestAnimationFrame 루프를 사용
- 스프라이트는 화면 밖 또는 비활성 탭에서 공통 가시성 훅으로 일시 정지
- `prefers-reduced-motion`에서는 CSS 이동 애니메이션 축소
- 편집기의 입력·버튼·선택 상자는 키보드 접근 가능
- 송출 화면은 16:9 비율과 텍스트 대비를 우선
- 업로드 Object URL은 컴포넌트 해제 시 즉시 폐기

현재 설정 JSON은 이미지 Blob 자체를 포함하지 않으므로 다른 컴퓨터로 옮길 때는
원본 스프라이트 파일도 함께 준비해야 합니다. 브라우저 DOM 이미지 내보내기 특성상
외부 도메인의 폰트·이미지를 직접 연결하면 CORS 정책에 따라 저장이 실패할 수
있습니다. 향후 개선 방향은 이미지까지 묶는 ZIP 백업, 물리 시뮬레이션의
Web Worker 이전, 운영자 인증과 여러 운영 기기 간 실시간 동기화입니다.

수련회에서 21개 조가 꾸민 베드로를 촬영하고, 학생 그림의 색과 무늬를 유지한
게임 캐릭터 스프라이트로 변환해 프로그램 사이마다 강당 메인 화면에 보여주는
자동 전시 웹앱입니다. 기본 화면은 단순한 갈릴리 게임 무대 위에 5~6명만 크게
보여줍니다.

## 기존 베드로 키우기 기능

- 16:9 벡터 셀 셰이딩 스타일의 `갈릴리 마당`
- 앞뒤 두 줄의 예약 위치 8개 중 6개를 사용해 캐릭터 겹침 방지
- 12초마다 한 명씩 교대하고 21개 조가 모두 나온 뒤에만 다시 섞는 공정 순환
- 촬영 사진을 고정 베드로 마스크로 정렬·배경 제거한 뒤 OpenAI로 게임 캐릭터화
- 한 번의 생성으로 대기·교차 걷기·손 흔들기 4×3 스프라이트 시트 제작
- 시트 각 칸의 가장자리와 연결된 단색 배경만 투명화해 흰 옷과 피부색 보존
- 사진 하단의 학생 제작 닉네임창 자동 추출과 조 이름 대체 표시
- 관리자 화면에서 조별 촬영 사진 등록, AI 생성 상태 확인, 전체 시트와 동작별 검수
- 검수를 승인한 AI 결과만 페이지 3 캐릭터에 적용
- AI 결과가 아직 없거나 생성에 실패한 조는 기존 종이인형 표현으로 안전하게 대체
- 로컬 SQLite / 배포 Neon Postgres 기반 21개 조 데이터 영구 저장
- 운영진용 조 정보·AI 캐릭터 등록·검수 화면

## 기술 구성

- 프론트엔드: React 19, TypeScript, Vite
- 메인 전시: CSS GPU 변환, Canvas 전처리, 4×3 스프라이트 애니메이션
- 백엔드: FastAPI, SQLite(로컬), Neon Postgres(Vercel)
- 파일 저장: 로컬 디렉터리(개발), Vercel Blob(배포)
- 배포 방식: Vite 빌드를 FastAPI가 같은 주소에서 제공

조 데이터, 업로드 이미지와 기존 API 형식은 React 전환 전과 동일하게 유지합니다.

## 설치 및 실행

Python 3.9 이상과 Node.js 20.17 이상이 필요합니다. 이 프로젝트는
`.nvmrc`로 Node.js 24.12.0 LTS를 사용합니다.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# .env의 OPENAI_API_KEY를 실제 비밀키로 교체

cd frontend
npm ci
npm run build
cd ..

uvicorn backend_main:app --env-file .env --host 0.0.0.0 --port 8000
```

`.env`는 Git에서 제외됩니다. 실제 키는 백엔드에서만 읽으며, `VITE_` 접두사가
붙은 환경 변수나 프론트엔드 코드에 넣지 마세요.

- 정면 라인업 송출: `http://localhost:8000/display/stand`
- 뒷모습 라인업 송출: `http://localhost:8000/display/back`
- 갈릴리 모닥불 송출: `http://localhost:8000/display/campfire`
- 전체 자리표 송출: `http://localhost:8000/display/seating`
- 시상식 송출: `http://localhost:8000/display/awards`
- 정면 라인업 배치 편집: `http://localhost:8000/editor/stand`
- 뒷모습 라인업 배치 편집: `http://localhost:8000/editor/back`
- 모닥불 배치 편집: `http://localhost:8000/editor/campfire`
- 전체 자리표 배치 편집: `http://localhost:8000/editor/seating`
- 시상식 배치 편집: `http://localhost:8000/editor/awards`
- 구 걷기·페이지 3 별칭(라인업으로 연결): `http://localhost:8000/display/walk`, `http://localhost:8000/page-3`
- 운영진 관리: `http://localhost:8000/admin`
- 21프레임 애니메이션 실험실: `http://localhost:8000/sprite-lab`
- 서버 상태: `http://localhost:8000/api/health`

`/`는 다섯 장면의 송출 화면과 배치 편집기로 이동하는 운영 허브입니다.
행사 운영 컴퓨터에서는 `/display/stand`, `/display/back`, `/display/campfire`,
`/display/seating`, `/display/awards`를
각각 크롬 전체 화면으로 열고 프로젝터 또는 LED 화면에 출력합니다. 전시 화면에는 버튼이나
스탯 패널 및 화면 전환 효과가 없으며, 선택한 종류만 유지한 채 7개 조씩
끊김 없이 이어서 재생됩니다. 전체 자리표만 예외로 21개 조를 3행 7열 한 화면에 표시합니다.
모든 배치 편집기에서는 요소를 선택한 뒤 왼쪽·오른쪽 회전 버튼으로 5도씩 돌릴 수 있습니다.
위치·크기·회전·포즈·표시 여부는 서버에 자동 저장되어 다른 브라우저의 송출 화면에도
동기화됩니다.

### 프론트엔드 개발 모드

백엔드를 8000번 포트로 실행한 상태에서 다른 터미널을 엽니다.

```bash
cd frontend
npm run dev
```

개발 전시 화면은 `http://localhost:5173/`, 관리 화면은
`http://localhost:5173/admin`에서 확인합니다. Vite가 `/api`, `/static`,
`/uploads` 요청을 FastAPI로 전달합니다. 행사에서는 개발 서버 대신 미리
`npm run build`한 뒤 FastAPI만 실행하세요.

## 21프레임 스프라이트 애니메이션 실험실

`/sprite-lab`은 포즈마다 열 수가 다른 원본 시트에서 추출한 21개 프레임을
가로형 애니메이션 시트로 다시 묶어 상태 전환과 실제 이동을 검증하는 개발용
화면입니다. 프레임 재생은 React 19 호환 `@ga1az/react-pixel-motion`이
담당하고, 실제 좌우 이동과 행동별 보조 모션은 기존 상태 머신과 CSS가 담당합니다.

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

제공된 원본은 1122×1402 RGB PNG입니다. 실제 알파 채널이 없고, 밝은 회색
체크보드가 이미지 픽셀로 포함되어 있습니다. 행마다 열 수가 다르며 다음과 같이
사용합니다.

1. 정면·3/4·측면·후면 기본 자세 5프레임
2. 걷기 6프레임
3. 뛰기 5프레임
4. 손 흔들기·점프·기도·무릎 꿇기·가리키기 5프레임

셀 크기는 거의 일정하지만 실제 캐릭터 바운딩 박스와 발바닥 위치는 포즈마다
달라 원본 전체를 CSS 격자로 재생하면 캐릭터가 흔들립니다. 전처리 스크립트는
각 좌표를 잘라 공통 투명 캔버스에 놓고 발 기준선을 맞춥니다. 얼굴, 구름 무늬,
하트 허리띠와 신발은 비교적 일관되지만 점프·기도·무릎 꿇기처럼 몸 높이가
달라지는 포즈는 `scripts/sprite_regions.json`에서 개별 보정할 수 있습니다.
흰 셔츠는 배경과 색이 가까워 구름 무늬를 시드로 한 보수적인 마스크 복원
과정을 거칩니다.

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
출력합니다. 흰 셔츠는 구름 무늬 주변을 복원해 유지합니다. 결과가 과하게
지워지면 JSON의 배경 임계값을 낮추고 다시 실행하세요.

좌표를 수정할 때는 `scripts/sprite_regions.json`의 해당 프레임 `x`, `y`,
`width`, `height`만 고칩니다. 캐릭터 크기는 `scale`, 좌우 위치는 `anchorX`,
발 위치는 `anchorY` 또는 공통 `baselineY`로 조정합니다. Python 코드를 수정할
필요는 없습니다.

### 애니메이션과 학생 캐릭터 추가

웹 애니메이션 정의는 `frontend/src/spriteLab/data.ts`에 있습니다. `fps`를
바꾸면 걷기·뛰기 속도를 조정할 수 있고, `scripts/sprite_regions.json`의
`animations` 배열에 같은 파일명 규칙의 PNG를 추가하면 가로형 시트의 프레임
수를 늘릴 수 있습니다. 상태 충돌 규칙은 `frontend/src/spriteLab/stateMachine.ts`에
분리되어 있습니다. 프레임 재생과 탭 일시정지는 `SpriteAnimator.tsx`, 실제
화면 이동은 `useCharacterMovement.ts`가 담당하므로 학생별 컴포넌트를 새로
만들 필요가 없습니다.

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

## 인쇄 도안부터 25컷 공용 캐릭터 적용까지

AI는 고정 25컷 마스터를 첫 번째 참조로, 보정된 학생 전신 그림을 두 번째 참조로
받아 새 5×5 시트를 만듭니다. 얼굴·머리·수염·체형·동작·프레임 순서·캐릭터
크기는 마스터에 잠그고, 학생 그림에서는 상의·하의·왼쪽 신발·오른쪽 신발
디자인만 옮깁니다. 생성 결과는 기존 공용 캐릭터와 같은 화면 점유율(대기 포즈
기준 약 292px 높이)과 마스터의 발 기준선으로 자동 정렬하므로 조마다 베드로
외형·동작·표시 크기는 같고 의상 디자인만 달라집니다.

1. `/print-template`의 A4 도안을 100% 크기로 인쇄합니다.
2. 학생들은 상의, 하의, 학생 기준 양쪽 신발만 꾸밉니다.
3. 종이 네 모서리와 캐릭터 전신이 모두 보이도록 휴대폰으로 정면 촬영합니다.
4. `/admin`에서 조를 선택하고 사진을 등록한 뒤 `사진 품질검사·자동 보정`을 누릅니다.
5. 서버가 촬영 선명도·눈부심·가림·네 모서리를 검사하고 종이 원근과 색상을
   자동 보정합니다.
6. 고정 마스터와 보정된 학생 디자인 참조를 나란히 확인합니다.
7. `AI로 마스터 고정 25컷 생성`을 눌러 대기, 걷기, 달리기, 점프, 손 흔들기,
   기도, 무릎 꿇기, 가리키기 프레임을 새로 만듭니다. 생성 중에는 AI 생성,
   크기·기준선 정렬, 자동 검수, 저장의 실제 서버 단계와 예상 진행률·경과 시간·
   예상 남은 시간을 관리자 화면에서 확인할 수 있습니다.
8. 25칸 전체 그리드와 실제 애니메이션 미리보기에서 머리·손·발·신발 잘림을
   검수합니다. 자동 검사는 각 프레임의 투명 여백, 마스터 대비 캐릭터 크기,
   하단 중앙 기준점, 의상 영역 침범 여부를 함께 판정합니다. 실패한 QA는 다음
   재생성 프롬프트에 자동 포함됩니다.
9. 문제가 없을 때 `PAGE 1·2·3·showcase 적용`을 승인합니다. 승인 전 후보는
   송출 화면에 나타나지 않으며, 이전 승인 버전은 관리자에서 복원할 수 있습니다.

GPT Image 2는 `quality=high`로 두 참조 이미지를 편집하며, 이 모델에는
`input_fidelity`를 보내지 않습니다. OpenAI Responses API는 휴대폰 촬영 품질과
최종 25컷의 정체성·의상 영역·잘림을 보조 판정합니다. 종이 원근·색상 보정,
배경 제거, 25칸 분할, 마스터 크기·기준점 정렬과 픽셀 경계 검사는 Pillow 기반의
결정적 후처리입니다. AI 검수가 실패하거나 사용할 수 없어도 후보를 자동
승인하지 않고 관리자가 실제 애니메이션을 확인하도록 유지합니다.

고정 마스터 원본을 교체했다면 다음 명령으로 각 포즈를 안전 여백 안에 다시
정렬해야 합니다. 이 단계가 원본 셀 경계를 넘은 머리나 다리 조각까지 회수해
실제 재생 중 잘리는 현상을 예방합니다.

```bash
python3 scripts/build_safe_master_atlas.py
```

활성 시트는 `showcase_sprite_url`과 버전 기록에 저장되며
`fixed-peter-garment-transfer-v2` 계약(5×5, 360×360px 셀)을 사용합니다.

## 운영 흐름

1. `/admin`에서 조 이름과 기본 정보를 입력
2. 촬영판에 베드로와 닉네임창을 놓고 조별 완성 사진 한 장 촬영
3. 조를 선택해 `2D 캐릭터 사진`에 등록
4. 메인 전시에서 실루엣·파츠 경계·닉네임창이 맞는지 확인
5. 21개 조를 모두 등록한 뒤 크롬 전체 화면으로 10분 이상 리허설

## 데이터와 생성 파일

- SQLite: `data/peter3d.db`
- 2D 원본 업로드: `uploads/`
- 직접 등록 GLB: `static/models/model-assets/{모델 ID}/model.glb` (로컬 개발)
- React 소스: `frontend/src/`
- 생성된 프론트엔드 빌드: `frontend/dist/`

SQLite, 업로드, 완성 GLB와 생성된 빌드는 Git에서 제외됩니다. 행사 전에는
`data/`, `uploads/`, `static/models/`을 별도 저장장치에 백업하고, 행사 종료 후
학생 그림의 보관·삭제 방침에 따라 정리하세요.

### Vercel 영구 저장소

배포 환경에서는 서버리스 함수의 임시 디스크에 의존하지 않습니다.

- 조 정보·성품·달란트·성장 기록·모델 보관함·조 배정: Neon Postgres
- 원본 PNG/JPG, AI 스프라이트 PNG와 등록 GLB: Vercel Blob

Vercel Function의 요청 본문 제한을 넘지 않도록 운영 화면은 3.8MB보다 큰 사진을
긴 변 2048px 이하의 JPG로 자동 최적화한 뒤 전송합니다. 원본 그림을 별도로
보관해야 한다면 촬영 기기에도 원본을 남겨두세요.

Vercel 프로젝트에는 `DATABASE_URL`(또는 `POSTGRES_URL`),
`BLOB_READ_WRITE_TOKEN`, `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`이
설정되어야 합니다. 비밀값은
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
- 21개 조를 등록한 상태로 크롬 전체 화면 10분 이상 자동 순환 확인
- Google Fonts를 로컬 글꼴로 교체해 완전 오프라인화
- 흰색 옷, 밝은 피부, 연한 무늬가 배경 투명화 뒤 유지되는지 확인
- 실제 iPad에서 21개 애니메이션 GLB를 넣은 10분 발열·프레임률 측정
- 운영진 수정 API에 PIN 또는 관리자 인증 적용
- 발표용 조별 자동 순회 연출
- 실제 촬영 현장에서 12컷 승인·재생 미리보기 흐름 리허설
