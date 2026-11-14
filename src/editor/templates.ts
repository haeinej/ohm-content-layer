// Page templates: Markdown the editor fills an empty page with. Synthetic, generic content.
import type { LucideIcon } from "lucide-react"
import { BarChart3Icon, CalendarDaysIcon, CircleDollarSignIcon, ListChecksIcon, MegaphoneIcon, NotebookPenIcon, PencilLineIcon } from "lucide-react"

export type Template = { id: string; name: string; icon: LucideIcon; emoji: string; markdown: string }

export const TEMPLATES: Template[] = [
  {
    id: "todo", name: "To-do list", icon: ListChecksIcon, emoji: "✅",
    markdown: `## Today

- [ ] Reply to messages
- [ ] Finish the draft
- [ ] Walk

## Later

- [ ] Sort the photos from the trip
- [ ] Read the saved articles`,
  },
  {
    id: "project", name: "Project tracker", icon: BarChart3Icon, emoji: "📊",
    markdown: `## 🔴 Needs immediate attention

- Communication systems test for launch

## ⛰️ Milestones

| Milestone | Status |
| --- | --- |
| Project brief | Complete |
| Prototype review | In progress |
| Launch readiness | Upcoming |

## ✅ Tasks

| Task | Owner | Status |
| --- | --- | --- |
| Confirm scope | Product | Done |
| Review designs | Design | In progress |
| Test the core flow | Engineering | Next |
| Prepare launch notes | Marketing | Next |`,
  },
  {
    id: "weekly", name: "Weekly update", icon: MegaphoneIcon, emoji: "📣",
    markdown: `## What happened

- Shipped the first version of the editor

## What is next

- Connect search

## What is in the way

- Nothing yet`,
  },
  {
    id: "feedback", name: "Feedback tracker", icon: PencilLineIcon, emoji: "✏️",
    markdown: `## 🔎 Key themes

1. Make onboarding easier to follow
2. Help people find the right template
3. Clarify what happens after sharing

## 🗂️ Feedback register

| Theme | Source | Next step |
| --- | --- | --- |
| Onboarding | Research notes | Shorten the first run |
| Navigation | Support | Group related pages |
| Sharing | Interviews | Explain who can see what |`,
  },
  {
    id: "planner", name: "Weekly planner", icon: CalendarDaysIcon, emoji: "📅",
    markdown: `## 📌 Priorities

- [ ] Finish the brief before Thursday
- [ ] Confirm next week's plans
- [ ] Leave one evening free

## 🗓️ Week at a glance

| Day | Main focus | Commitments |
| --- | --- | --- |
| Monday | Explore ideas | Team call |
| Tuesday | First draft | Review |
| Wednesday | Send the draft | None |`,
  },
  {
    id: "budget", name: "Budget tracker", icon: CircleDollarSignIcon, emoji: "💵",
    markdown: `Budget period: this month

## Planned and actual spending

| Category | Planned | Actual | Remaining |
| --- | --- | --- | --- |
| Housing |  |  |  |
| Food |  |  |  |
| Transport |  |  |  |

## Transactions

Add income and expenses with dates and sources.`,
  },
  {
    id: "release", name: "Release notes", icon: NotebookPenIcon, emoji: "📓",
    markdown: `## 🆕 New

- New capabilities and who they are for

## 🔧 Improvements

- Changes to existing workflows

## 🩹 Fixes

- Resolved issues and their impact

## 🌍 Availability

- Supported platforms, rollout status and known limitations`,
  },
]

/** The chips under an empty page's title. The rest are in the gallery. */
export const QUICK_TEMPLATES = TEMPLATES.slice(0, 4)
