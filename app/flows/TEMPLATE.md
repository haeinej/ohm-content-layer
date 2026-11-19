# <Flow name>

<One sentence: who does this, and what is true when it's done.>

- **Flow id:** `<flow>`. It prefixes every tool name.
- **Starts from:** <where the person, or agent, enters>
- **Ends in:** <the end states: done, declined, cancelled, failed>

## Steps

| # | Step | Screen (ohm-ui) | Primary action (forest) | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | <step> | <e.g. `Panel` + `Field`, `Input`> | <button label> | `<flow>.<step>` | `readOnlyHint` | none |
| 2 | Preview | <e.g. `Card`> | <label> | `<flow>.preview` | `readOnlyHint` | none |
| 3 | Confirm | `ApprovalCard` | <label> | `<flow>.confirm` | `consequentialHint` | `ApprovalCard` |

## Tools

### `<flow>.<step>`

- **title:** <the button label>
- **description:** <one or two plain sentences: what it does, what it returns>
- **inputSchema:**

```json
{ "type": "object", "properties": {}, "required": [], "additionalProperties": false }
```

- **outputSchema:** `{ "state": ..., "id": ..., "next": "<flow>.<next-step>" }`
- **Handler:** `<module>#<function>`, the same one the button calls
- **Errors:** `DataError` when <...>; `OperationError` when <...>

## States

| Situation | What the person sees |
| --- | --- |
| Loading | blank, or `LoadingDot` |
| Agent working | `AgentStatus` |
| Done | `notify()` (success) |
| Declined, cancelled | the step as it was, nothing written |
| Failed | `notify()` (destructive) with a plain reason |
| Empty | `Empty`, with the action that fills it |

## Cross-origin

None. <Or: which origin, why, `allow="tools"` + `exposedTo`.>

## Checked

- [ ] By hand, in light and dark, on a phone and a desktop
- [ ] By tools: `getTools()` per step, then `executeTool` reaches the same end state
- [ ] Every consequential tool stops at approval; declining and aborting leave nothing behind
