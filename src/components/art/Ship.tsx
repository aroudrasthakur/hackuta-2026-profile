import type { CSSProperties } from "react";

type ShipTone = "ink" | "clay";

type ShipProps = {
  className?: string;
  style?: CSSProperties;
  rowing?: boolean;
  tone?: ShipTone;
};

type OarStyle = CSSProperties & {
  "--oar-delay": string;
};

const OAR_POSITIONS = [122, 167, 212, 257, 302, 347] as const;

export function Ship({
  className = "",
  style,
  rowing = true,
  tone = "ink",
}: ShipProps) {
  const detail = tone === "ink" ? "var(--clay)" : "var(--night)";

  return (
    <svg
      className={`art-ship ${className}`}
      style={{
        color: `var(--${tone})`,
        ...style,
      }}
      data-rowing={rowing ? "true" : "false"}
      viewBox="0 0 520 340"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M243 51v201M150 87l200-6M153 89l-45 161M348 82l72 166"
        stroke="currentColor"
        strokeWidth="3"
      />

      <path
        d="M243 17v44m0-39 41 10-41 13"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="4"
      />

      <g className="ship-sail">
        <path
          d="M158 88c17 45 13 87-5 125 62-17 135-16 203 1-20-43-25-88-12-131Z"
          fill="currentColor"
        />

        <path
          d="M177 97c13 34 11 73-1 100 49-11 106-11 159 0-13-30-17-67-10-99M245 98v91"
          stroke={detail}
          strokeWidth="2"
          opacity=".7"
        />

        <path d="m244 124 21 21-21 21-21-21Z" stroke={detail} strokeWidth="2" />

        <circle cx="244" cy="145" r="6" fill={detail} />
      </g>

      <path
        d="M44 234c29 35 67 46 113 47h217c50-1 82-20 107-67l-7 42c-34 51-59 60-105 60H157c-54 0-98-30-113-82Z"
        fill="currentColor"
      />

      <path
        d="M55 244h365c25 0 37-10 44-25l9-27 13 6-2 17M75 269c52 28 139 25 215 25h88c30 0 54-14 66-28"
        stroke="currentColor"
        strokeWidth="7"
      />

      <path
        d="M92 278c47 20 86 23 156 23h120c25 0 50-10 63-21"
        stroke={detail}
        strokeWidth="2"
      />

      {OAR_POSITIONS.map((x, index) => {
        const oarStyle: OarStyle = {
          "--oar-delay": `${index * -0.14}s`,
        };

        return (
          <g key={x}>
            <circle cx={x} cy="223" r="8" fill="currentColor" />

            <path d={`M${x - 6} 233l-5 18h23l-6-18Z`} fill="currentColor" />

            <g className="ship-oar" style={oarStyle}>
              <path
                d={`M${x} 258l-39 66`}
                stroke="currentColor"
                strokeWidth="5"
              />

              <path d={`m${x - 34} 307-15 21 7 4 13-22Z`} fill="currentColor" />
            </g>
          </g>
        );
      })}

      <circle cx="454" cy="248" r="5" fill={detail} />

      <path
        d="M58 252 30 217M34 214l-7-20M104 265l-60 57"
        stroke="currentColor"
        strokeWidth="5"
      />
    </svg>
  );
}
