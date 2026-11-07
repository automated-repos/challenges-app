import type { CarShape } from "@/lib/bankBoard";

/** سيارة صغيرة (منظر جانبي متجه لليمين) بلون اللاعب وشكل سيارته */
export function CarIcon({
  shape,
  color,
  size = 32,
  className = "",
}: {
  shape: CarShape;
  color: string;
  size?: number;
  className?: string;
}) {
  const glass = "#bae6fd";
  const dark = "#1e1b4b";
  const wheel = (cx: number) => (
    <g key={cx}>
      <circle cx={cx} cy={25} r={5} fill={dark} />
      <circle cx={cx} cy={25} r={2} fill="#cbd5e1" />
    </g>
  );

  let body: React.ReactNode;
  switch (shape) {
    case "sport":
      body = (
        <>
          <path d="M3 22 Q4 16 12 15 L22 14 Q28 9 36 9 Q44 9 50 14 L59 16 Q62 18 61 22 Z" fill={color} stroke={dark} />
          <path d="M25 14 Q30 10.5 36 10.5 Q42 10.5 46 14 Z" fill={glass} />
          <rect x={4} y={12} width={4} height={2} fill={dark} />
          {wheel(15)}
          {wheel(50)}
        </>
      );
      break;
    case "jeep":
      body = (
        <>
          <rect x={6} y={6} width={50} height={17} rx={3} fill={color} stroke={dark} />
          <rect x={10} y={9} width={16} height={7} rx={1} fill={glass} />
          <rect x={30} y={9} width={16} height={7} rx={1} fill={glass} />
          <rect x={1} y={12} width={6} height={9} rx={2} fill={dark} />
          {wheel(16)}
          {wheel(46)}
        </>
      );
      break;
    case "pickup":
      body = (
        <>
          <path d="M3 22 L3 15 L30 15 L30 13 L58 13 L58 22 Z" fill={color} stroke={dark} />
          <path d="M36 13 L40 6 L54 6 L58 13 Z" fill={color} stroke={dark} />
          <path d="M41 12 L43.5 7.5 L53 7.5 L55 12 Z" fill={glass} />
          <rect x={5} y={15} width={23} height={2} fill={dark} opacity={0.4} />
          {wheel(14)}
          {wheel(48)}
        </>
      );
      break;
    case "van":
      body = (
        <>
          <path d="M3 23 L3 7 Q3 4 6 4 L48 4 Q54 4 58 12 L61 16 L61 23 Z" fill={color} stroke={dark} />
          <rect x={8} y={8} width={11} height={7} rx={1} fill={glass} />
          <rect x={22} y={8} width={11} height={7} rx={1} fill={glass} />
          <path d="M37 8 L47 8 Q52 8 55 14 L37 14 Z" fill={glass} />
          {wheel(15)}
          {wheel(50)}
        </>
      );
      break;
    default: {
      // sedan و taxi: نفس الهيكل، والتاكسي بلافتة على السقف ومربعات
      body = (
        <>
          <path
            d="M3 22 L3 16 Q3 14 6 14 L16 13 L23 6 Q24 5 26 5 L42 5 Q44 5 45 6 L52 13 L58 14 Q61 15 61 18 L61 22 Z"
            fill={color}
            stroke={dark}
          />
          <path d="M19 13 L25 7 L33 7 L33 13 Z" fill={glass} />
          <path d="M35 13 L35 7 L42 7 L48 13 Z" fill={glass} />
          {shape === "taxi" && (
            <>
              <rect x={28} y={0.5} width={12} height={4.5} rx={1} fill="#fde047" stroke={dark} strokeWidth={0.8} />
              <path d="M6 17 h52" stroke={dark} strokeWidth={1.6} strokeDasharray="3 3" />
            </>
          )}
          {wheel(15)}
          {wheel(49)}
        </>
      );
    }
  }

  return (
    <svg
      width={size * 2}
      height={size}
      viewBox="0 0 64 32"
      className={`shrink-0 drop-shadow ${className}`}
      aria-label="سيارة"
    >
      {body}
      <circle cx={60} cy={18} r={1.6} fill="#fef08a" />
    </svg>
  );
}
