/** Static, decorative texture shared by branded introductions. */
export function Atmosphere({ className = '' }: { className?: string }) {
  return (
    <div
      className={`atmosphere-decoration ${className}`.trim()}
      aria-hidden="true"
    >
      <span className="atmosphere-rays" />
      {Array.from({ length: 8 }, (_, index) => (
        <i key={index} />
      ))}
    </div>
  );
}
