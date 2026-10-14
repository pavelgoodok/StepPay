/**
 * Сеть линий в стиле микросхемы для карточки кошелька: дорожки с узлами и контактными площадками, часть дорожек «течет».
 * Рисунок широкий и прижат вправо: слева, где цифры, он гаснет маской из стилей.
 */
const NODES: [number, number][] = [[760, 60], [1010, 76], [1040, 46], [700, 36], [960, 140], [1130, 190], [1100, 100], [820, 330], [1010, 320], [700, 290], [980, 290], [1190, 220], [640, 20]];

export function CircuitNet() {
  return (
    <svg className="net" viewBox="0 0 1200 360" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">
      <g className="traces" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M700 36H820L860 76H1010L1040 46H1200" className="flow" />
        <path d="M560 20H640L680 60H760" />
        <path d="M900 0V40L930 70V110L960 140H1040" className="flow slow" />
        <path d="M600 150H760L800 180H940L980 220H1200" />
        <path d="M1100 100V160L1130 190H1200" />
        <path d="M640 330H780L820 290H980L1010 320H1200" className="flow" />
        <path d="M620 260H700L730 290H760" />
        <path d="M1040 360V300L1070 270H1200" />
        <path d="M820 360V330" />
        <path d="M1160 0V30L1190 60H1200" />
      </g>
      <g className="pads">
        <rect x="856" y="70" width="12" height="12" rx="2.5" />
        <rect x="796" y="174" width="12" height="12" rx="2.5" />
        <rect x="976" y="214" width="12" height="12" rx="2.5" />
        <rect x="816" y="284" width="12" height="12" rx="2.5" />
        <rect x="1066" y="264" width="12" height="12" rx="2.5" />
      </g>
      <g className="dots">
        {NODES.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="5" className={i % 3 === 0 ? "pulse" : undefined} />
        ))}
      </g>
    </svg>
  );
}
