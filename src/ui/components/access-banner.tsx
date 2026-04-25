export function AccessBanner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
      <span>🔒</span>
      <span>{text}</span>
    </div>
  );
}
