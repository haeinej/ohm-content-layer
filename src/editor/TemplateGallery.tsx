import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { TEMPLATES, type Template } from "./templates"

/** A tiny, faithful-enough preview of a template: its headings, lines and tables, drawn small. */
function Preview({ t }: { t: Template }) {
  const lines = t.markdown.split("\n").filter(Boolean).slice(0, 14)
  return (
    <div className="pointer-events-none flex h-36 flex-col gap-1 overflow-hidden rounded-md bg-background p-3 text-[7px] leading-tight shade-1" aria-hidden>
      <Icon icon={t.icon} size="xs" className="mb-1 text-muted-foreground" />
      {lines.map((l, i) =>
        l.startsWith("## ") ? <p key={i} className="mt-1 font-semibold">{l.slice(3)}</p>
          : l.startsWith("|") ? (l.includes("---") ? null : <div key={i} className="grid grid-flow-col gap-1 border-b border-border py-0.5 text-muted-foreground">{l.split("|").filter(c => c.trim()).map((c, j) => <span key={j} className="truncate">{c.trim()}</span>)}</div>)
          : <p key={i} className="truncate text-muted-foreground">{l.replace(/^- \[ \] /, "☐ ").replace(/^- /, "• ")}</p>,
      )}
    </div>
  )
}

export function TemplateGallery({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (t: Template) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto rounded-lg sm:max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Templates</DialogTitle>
          <DialogDescription>Start a page from one. You can change everything after.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-2 sm:grid-cols-3">
          {TEMPLATES.map(t => (
            <button key={t.id} type="button" onClick={() => onPick(t)}
              className="group flex flex-col gap-2 rounded-lg p-1.5 text-center transition-colors duration-(--ohm-duration-state) hover:bg-muted">
              <div className="transition-transform duration-(--ohm-duration-state) ease-(--ohm-ease-out) group-hover:-translate-y-0.5"><Preview t={t} /></div>
              <span className="text-body">{t.name}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
