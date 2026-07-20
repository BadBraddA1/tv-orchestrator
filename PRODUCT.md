# Product

## Register

product

## Users

Household members (especially non-tech partners) requesting TV and movies into Plex from phone/desktop. Admin (Brad) manages stack health, cleanup, and settings on a home LAN. Context: “I want this in Plex tonight without asking anyone.”

## Product Purpose

TV Orchestrator (“orca”) turns a Proxmox media stack into a simple request → grab → import loop for **TV and movies**, plus library inventory, gap fills, and stale cleanup. Success is: anyone in the house finds a title, taps Request, and it appears in Plex — no SSH, no Sonarr/Radarr UI.

## Brand Personality

Broadcast · Precise · Quietly capable

Feels like a living-room control room: dark surfaces, clear status, no ceremony. Confidence over flash.

## Anti-references

- Purple-glow “AI dashboard” kits and heavy glassmorphism
- Overseerr/Plex-clone marketing polish that hides ops state
- Dense Sonarr wall-of-numbers with no visual hierarchy

## Design Principles

1. **Status before chrome** — free space, pending deletes, grab failures should read at a glance.
2. **Ops, not theater** — motion and graphics explain state (countdown, size bars), never decorate.
3. **One action layer** — primary buttons for the thing you’re here to do; ghosts for secondary.
4. **Safe by default** — destructive flows show grace/countdown visually before anything vanishes.
5. **Trust the stack** — familiar tabs and list patterns; invent nothing a fluent admin has to relearn.

## Accessibility & Inclusion

WCAG AA contrast on dark UI. Respect `prefers-reduced-motion`. Focus rings on all controls. Don’t rely on color alone for status (pair chips with labels).
