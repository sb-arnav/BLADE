const keyframes = `
@keyframes dot-bounce {
  0%, 60%, 100% { transform: scale(1); opacity: 0.4; }
  30% { transform: scale(1.8); opacity: 1; }
}
`;

export default function TypingIndicator({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <>
      <style>{keyframes}</style>
      <div className="pl-3 border-l-2 border-blade-accent/30 animate-fade-in flex items-center gap-1.5 h-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1 h-1 rounded-full bg-blade-accent"
            style={{
              animation: `dot-bounce 1.2s ${i * 0.15}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
    </>
  );
}
