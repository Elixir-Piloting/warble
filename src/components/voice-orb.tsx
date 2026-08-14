export function VoiceOrb({ active = false }: { active?: boolean }) {
  return (
    <div
      className={`relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_30%_25%,var(--primary),var(--chart-2)_42%,var(--muted)_74%)] ${active ? "animate-pulse" : ""}`}
    >
      <div className="border-primary-foreground/40 absolute inset-2 rounded-full border" />
      <div className="bg-primary-foreground/70 absolute bottom-2 left-[14px] h-2 w-0.5 rounded-full" />
      <div className="bg-primary-foreground/70 absolute bottom-2 left-[18px] h-3 w-0.5 rounded-full" />
      <div className="bg-primary-foreground/70 absolute bottom-2 left-[22px] h-1.5 w-0.5 rounded-full" />
    </div>
  );
}
