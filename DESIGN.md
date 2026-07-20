# Design System — TV Orchestrator

## Theme
Dark broadcast-ops: cool slate surfaces, one electric teal-cyan accent for primary actions, amber for stale/grace, coral for failure. No purple.

## Colors
| Role | Token | Value |
|------|--------|--------|
| Background deep | `--bg0` | `oklch(0.16 0.02 250)` |
| Background lift | `--bg1` | `oklch(0.20 0.025 250)` |
| Panel | `--panel` | `oklch(0.24 0.025 250)` |
| Ink | `--ink` | `oklch(0.96 0.01 250)` |
| Muted | `--muted` | `oklch(0.72 0.03 250)` |
| Accent | `--accent` | `oklch(0.72 0.14 210)` |
| OK | `--ok` | `oklch(0.75 0.15 155)` |
| Warn | `--warn` | `oklch(0.82 0.14 85)` |
| Err | `--err` | `oklch(0.72 0.16 25)` |

## Typography
System UI stack (`"Segoe UI", system-ui, sans-serif`). Fixed rem steps: 0.75 / 0.875 / 1 / 1.25 / 1.75 for labels / body / titles.

## Components
- **Stat rail**: 3–4 metric tiles with value + label + thin fill bar
- **Meter row**: episode row with relative size bar and grace countdown ring
- **Chip**: uppercase status labels (ok / warn / err)
- **Tabs**: underline/active fill, no glass

## Layout
Max content 1100px. Cleanup: stats → pending (cards with countdown) → stale list with checkboxes + size meters.

## Motion
150–220ms ease-out on hover/selected. Countdown ring is CSS; honor prefers-reduced-motion (static %).
