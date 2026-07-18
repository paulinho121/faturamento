export function EmptyState({ icon, title, description }: { icon: string; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-sm py-xl text-center">
      <span className="material-symbols-outlined text-on-surface-variant text-[40px]">{icon}</span>
      <p className="font-title-md text-title-md text-on-surface">{title}</p>
      {description && <p className="font-body-md text-body-md text-on-surface-variant max-w-xs">{description}</p>}
    </div>
  )
}
