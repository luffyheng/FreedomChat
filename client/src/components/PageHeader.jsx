export default function PageHeader({ title, subtitle, eyebrow, actions }) {
  return (
    <div className="px-8 pt-8 pb-5 border-b border-ink-line bg-paper-50">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[11px] font-medium text-ink-mute uppercase tracking-eyebrow mb-2">
              {eyebrow}
            </div>
          )}
          <h1 className="text-[22px] font-semibold tracking-tightest text-ink leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 text-[13.5px] text-ink-mute max-w-2xl leading-relaxed">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
