import { useEffect } from 'react';
import { createPeterAnimations } from '../spriteLab/data';
import { SpriteAnimator } from '../spriteLab/SpriteAnimator';
import type { AnimationName, CharacterDefinition } from '../spriteLab/types';
import '../styles/garment-test.css';

const ASSET_ROOT = '/assets/peter-garment-demo';
const SAMPLE_CHARACTER: CharacterDefinition = {
  id: 'garment-transfer-sample',
  name: '바다별 베드로',
  group: '1조 테스트',
  animations: createPeterAnimations(`${ASSET_ROOT}/frames`, { jump: 1 }),
};

const MOTIONS: Array<{ name: AnimationName; label: string; note: string }> = [
  { name: 'walk', label: '걷기 8프레임', note: '옆모습과 교차 보행 유지' },
  { name: 'run', label: '달리기 8프레임', note: '큰 보폭에서도 무늬 유지' },
  { name: 'wave', label: '손 흔들기', note: '소매까지 상의 디자인 적용' },
  { name: 'jump', label: '점프', note: '머리와 발이 잘리지 않음' },
];

export default function GarmentTransferTestPage() {
  useEffect(() => {
    document.title = '의상 합성 테스트 | 베드로 키우기';
  }, []);

  return (
    <main className="garment-test">
      <header className="garment-test__header">
        <div>
          <span>FIXED MASTER · GARMENT TRANSFER TEST</span>
          <h1>베드로는 그대로, 학생의 옷만 입혔어요</h1>
          <p>
            하나의 고정 마스터를 사용해 얼굴·수염·체형·동작은 잠그고,
            학생 그림에서 추출한 상의와 하의 픽셀만 25개 프레임에 합성했습니다.
          </p>
        </div>
        <a href="/page-3">PAGE 3에서 1조 확인하기</a>
      </header>

      <section className="garment-test__pipeline" aria-label="의상 합성 과정">
        <article className="garment-test__card garment-test__card--input">
          <header>
            <span>1</span>
            <div>
              <strong>학생 그림 입력</strong>
              <small>크레용·마커 질감 포함</small>
            </div>
          </header>
          <div className="garment-test__image-stage garment-test__image-stage--paper">
            <img
              src={`${ASSET_ROOT}/source/student-garment-sample.png`}
              alt="학생이 그린 파도와 별 상의, 물고기 하의 디자인"
            />
          </div>
        </article>

        <article className="garment-test__card garment-test__card--extract">
          <header>
            <span>2</span>
            <div>
              <strong>디자인만 추출</strong>
              <small>베드로 외형 정보는 사용하지 않음</small>
            </div>
          </header>
          <div className="garment-test__textures">
            <figure>
              <img src={`${ASSET_ROOT}/upper-texture.png`} alt="추출된 상의 텍스처" />
              <figcaption>상의 텍스처</figcaption>
            </figure>
            <figure>
              <img src={`${ASSET_ROOT}/lower-texture.png`} alt="추출된 하의 텍스처" />
              <figcaption>하의 텍스처</figcaption>
            </figure>
          </div>
          <ul>
            <li>파도·별 위치와 손그림 결 보존</li>
            <li>물고기·공기방울과 불균일한 색칠 보존</li>
            <li>마스터의 갈색 허리띠는 고정</li>
          </ul>
        </article>

        <article className="garment-test__card garment-test__card--result">
          <header>
            <span>3</span>
            <div>
              <strong>고정 마스터 25컷 합성</strong>
              <small>5 × 5 · 투명 배경</small>
            </div>
          </header>
          <a
            className="garment-test__image-stage garment-test__image-stage--atlas"
            href={`${ASSET_ROOT}/themed-master.png`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={`${ASSET_ROOT}/themed-master.png`}
              alt="학생 의상 디자인이 적용된 베드로 25컷 마스터 시트"
            />
          </a>
        </article>
      </section>

      <section className="garment-test__motion-section">
        <header>
          <div>
            <span>4 · WEB PREVIEW</span>
            <h2>실제 웹 애니메이션 검수</h2>
          </div>
          <p>아래 결과가 승인되면 같은 프레임 묶음을 해당 조의 PAGE 3 캐릭터로 사용합니다.</p>
        </header>
        <div className="garment-test__motions">
          {MOTIONS.map((motion) => (
            <article key={motion.name}>
              <div className="garment-test__motion-stage">
                <SpriteAnimator
                  character={SAMPLE_CHARACTER}
                  animation={motion.name}
                  playing
                  respectReducedMotion={false}
                />
              </div>
              <strong>{motion.label}</strong>
              <small>{motion.note}</small>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
