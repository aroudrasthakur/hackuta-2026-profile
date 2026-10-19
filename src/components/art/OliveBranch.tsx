export function OliveBranch({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 240 240" fill="none" aria-hidden="true"><path d="M38 214C65 161 111 113 204 29" stroke="currentColor" strokeWidth="3" />{[0, 1, 2, 3, 4].map((i) => <g key={i} transform={`translate(${50 + i * 30} ${188 - i * 32}) rotate(-43)`}><path d="M0 0C-35-4-47-22-42-42-16-40-1-23 0 0ZM2 0c31-1 46-14 46-33C25-38 7-20 2 0Z" fill="currentColor" /><path d="m-4-6-28-25M9-6l28-21" stroke="var(--night)" strokeWidth="1.5" /></g>)}</svg>
}
