import { useEffect } from 'react';
import '../styles/print-template.css';

const TEMPLATE_URL = '/assets/showcase/peter-print-template.png';

export default function PrintTemplatePage() {
  useEffect(() => {
    document.title = '베드로 꾸미기 도안 | 인쇄';
  }, []);

  return (
    <main className="print-template-page">
      <header className="print-template-toolbar" aria-label="인쇄 도안 도구">
        <div>
          <h1>베드로 꾸미기 도안</h1>
          <p>A4 100% 크기로 인쇄해 상의, 하의, 왼쪽 신발, 오른쪽 신발을 꾸며주세요.</p>
        </div>
        <div className="print-template-actions">
          <button type="button" onClick={() => window.print()}>인쇄</button>
          <a href={TEMPLATE_URL} download="peter-print-template.png">PNG 다운로드</a>
        </div>
      </header>

      <section className="print-template-sheet" aria-label="A4 인쇄 도안">
        <div className="print-corner print-corner--tl" aria-hidden="true" />
        <div className="print-corner print-corner--tr" aria-hidden="true" />
        <div className="print-corner print-corner--bl" aria-hidden="true" />
        <div className="print-corner print-corner--br" aria-hidden="true" />
        <img src={TEMPLATE_URL} alt="상하의와 좌우 신발을 꾸미는 베드로 빈 도안" />
        <aside className="print-template-instructions">
          <strong>촬영 전 확인</strong>
          <span>종이 네 모서리가 사진 안에 모두 보이게 정면에서 촬영</span>
          <span>학생 기준 왼쪽 신발과 오른쪽 신발을 각각 꾸미기</span>
          <span>진한 색연필 또는 사인펜 사용, 반사와 그림자 줄이기</span>
        </aside>
      </section>
    </main>
  );
}
