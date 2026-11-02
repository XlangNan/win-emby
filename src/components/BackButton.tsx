import { useNavigate } from 'react-router-dom';

export default function BackButton({ fallback = '/', label = '返回', onClick }: { fallback?: string; label?: string; onClick?: () => void }) {
  const nav = useNavigate();
  return (
    <button
      className="back-btn"
      title="返回上一页（Alt+← / Backspace）"
      onClick={() => {
        if (onClick) return onClick();
        if (window.history.length > 1) nav(-1);
        else nav(fallback, { replace: true });
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24">
        <path d="M15.5 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
