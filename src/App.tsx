import { useEffect } from "react"
import { Notices } from "@/components/ui/notice"
import { TooltipProvider } from "@/components/ui/tooltip"
import { MainPanel } from "@/workspace/MainPanel"
import { Rack } from "@/workspace/Rack"
import { SearchOverlay } from "@/workspace/SearchOverlay"
import { SidePanel } from "@/workspace/SidePanel"
import { createDraft, setSearchOpen, showGraph } from "@/workspace/store"
import { useWorkspaceTools } from "@/workspace/tools"

function toggleTheme() {
  const root = document.documentElement
  const dark = root.dataset.theme === "dark" || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches)
  root.dataset.theme = dark ? "light" : "dark"
}

export function App() {
  useWorkspaceTools()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      const run = { k: () => setSearchOpen(true), n: () => createDraft(), g: () => showGraph() }[k]
      if (run) { e.preventDefault(); run() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <TooltipProvider>
      <div className="relative flex h-full overflow-hidden bg-background text-foreground">
        <Rack onTheme={toggleTheme} />
        <SidePanel />
        <MainPanel />
      </div>
      <SearchOverlay />
      <Notices />
    </TooltipProvider>
  )
}
