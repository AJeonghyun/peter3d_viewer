# 베드로 키우기 — Peter3D

수련회에서 25개 조가 색칠한 베드로를 3D로 변환하고, 갈릴리 호숫가에서
걸어 다니는 조별 캐릭터와 용기·현명·진실·열정의 성장 현황을 보여주는
iPad 키오스크용 프로토타입입니다.

## 현재 구현된 기능

- 갈릴리 호숫가, 모닥불, 배가 있는 Three.js 월드
- 25명의 베드로 배치 및 구역별 걷기
- 베드로 터치 또는 `우리 조 찾기`를 통한 조 선택
- 4축 성품 차트, 달란트, 레벨, 칭호, 성장 기록
- 45초 미조작 시 키오스크 자동 초기화
- 로컬 SQLite / 배포 Neon Postgres 기반 25개 조 데이터 영구 저장
- 운영진용 조 정보·달란트·성품 관리 화면
- 조와 독립된 PNG/JPG 모델 생성 보관함과 최대 3개 동시 변환 워커
- 완성된 GLB 하나를 선택한 여러 조 또는 전체 25조에 재사용
- Tripo 이미지→3D→무료 리깅 검사→Biped 리깅→걷기 GLB 파이프라인
- 변환 실패 원인과 작업 상태 저장

실제 GLB가 없는 조는 가벼운 데모 캐릭터로 표시되며, 변환이 완료되면 월드가
서버 상태를 확인하여 실제 모델을 자동으로 불러옵니다.

## 기술 구성

- 프론트엔드: React 19, TypeScript, Vite
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
# .env의 TRIPO_API_KEY를 tsk_로 시작하는 Tripo OpenAPI 비밀키로 교체

cd frontend
npm ci
npm run build
cd ..

uvicorn backend_main:app --env-file .env --host 0.0.0.0 --port 8000
```

`.env`는 Git에서 제외됩니다. 실제 키는 백엔드에서만 읽으며, `VITE_` 접두사가
붙은 환경 변수나 프론트엔드 코드에 넣지 마세요.

- 학생용 갈릴리 월드: `http://localhost:8000/`
- 운영진 관리: `http://localhost:8000/admin`
- 서버 상태: `http://localhost:8000/api/health`

행사 공유기에 운영 노트북과 iPad를 연결한 후 iPad에서
`http://운영노트북_IP:8000/`으로 접속합니다.

### 프론트엔드 개발 모드

백엔드를 8000번 포트로 실행한 상태에서 다른 터미널을 엽니다.

```bash
cd frontend
npm run dev
```

개발 화면은 `http://localhost:5173/`, 관리 화면은
`http://localhost:5173/admin`에서 확인합니다. Vite가 `/api`, `/static`,
`/uploads` 요청을 FastAPI로 전달합니다. 행사에서는 개발 서버 대신 미리
`npm run build`한 뒤 FastAPI만 실행하세요.

## Tripo 변환 설정

기본값은 비용과 현장 안정성을 고려해 다음과 같습니다.

- 입력 이미지 자동 보정(`enable_image_autofix=true`)
- 기본 프로필: H3.1 `v3.1-20260211` + 생성 단계 Smart Low Poly
- 비교 프로필: P1 `P1-20260311`(자체 저폴리, Smart Low Poly 중복 적용 안 함)
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

## 25개 애니메이션 모델 성능 정책

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

1. `/admin`에서 조 이름, 대표색, 상징, 설명 입력
2. 모델 이름과 색칠 그림을 등록해 공용 GLB 생성 시작
3. 변환 작업 목록에서 3D·리깅·대기·걷기 완료 여부 확인
4. 모델 보관함에서 적용할 조들을 선택하고 한 번에 배정
5. 실패 모델은 팔다리가 잘 보이게 다시 촬영해 재등록
6. 프로그램 결과에 따라 달란트와 성품 변화 입력
7. iPad 월드에서 조별 현황 확인
8. 발표 전 네트워크를 끊고 필요한 화면이 동작하는지 리허설

## 데이터와 생성 파일

- SQLite: `data/peter3d.db`
- 원본 업로드: `uploads/`
- 완성 GLB: `static/models/asset-{작업 ID}/` (새 공용 생성 흐름)
- React 소스: `frontend/src/`
- 생성된 프론트엔드 빌드: `frontend/dist/`

SQLite, 업로드, 완성 GLB와 생성된 빌드는 Git에서 제외됩니다. 행사 전에는
`data/`, `uploads/`, `static/models/`을 별도 저장장치에 백업하고, 행사 종료 후
학생 그림의 보관·삭제 방침에 따라 정리하세요.

### Vercel 영구 저장소

배포 환경에서는 서버리스 함수의 임시 디스크에 의존하지 않습니다.

- 조 정보·성품·달란트·성장 기록·변환 작업·모델 보관함·조 배정: Neon Postgres
- 원본 PNG/JPG와 완성 GLB: Vercel Blob
- 임시 Tripo 업로드 파일: 함수 실행 중에만 `/tmp` 사용 후 즉시 삭제

Vercel Function의 요청 본문 제한을 넘지 않도록 운영 화면은 3.8MB보다 큰 사진을
긴 변 2048px 이하의 JPG로 자동 최적화한 뒤 전송합니다. 원본 그림을 별도로
보관해야 한다면 촬영 기기에도 원본을 남겨두세요.

Vercel 프로젝트에는 `DATABASE_URL`(또는 `POSTGRES_URL`),
`BLOB_READ_WRITE_TOKEN`, `TRIPO_API_KEY`, `TRIPO_PIPELINE_PROFILE`이 설정되어야
합니다. 비밀값은 `.env`, `.env.local` 또는 Vercel 환경 변수에만 두고 저장소에
커밋하지 마세요. `/api/health`의 `persistent_storage`가 `true`이면 두 영구
저장소가 모두 연결된 상태입니다.

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

- Google Fonts를 로컬 글꼴로 교체해 완전 오프라인화
- 실제 Tripo 변환 2~3건 통합 테스트
- 실제 iPad에서 25개 애니메이션 GLB를 넣은 10분 발열·프레임률 측정
- 운영진 수정 API에 PIN 또는 관리자 인증 적용
- 발표용 조별 자동 순회 연출
- 사진 촬영 가이드 및 변환 결과 승인/재시도 UX 강화
