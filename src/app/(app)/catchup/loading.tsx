export default function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <div className="skeleton" style={{ height: 30, width: '46%' }} />
      <div className="skeleton" style={{ height: 16, width: '68%' }} />
      <div className="skeleton" style={{ height: 120, marginTop: 14 }} />
      <div className="skeleton" style={{ height: 120 }} />
    </div>
  );
}
