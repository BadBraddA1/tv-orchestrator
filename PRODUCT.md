# Product

## Register

product

## Users

Household admin (and signed-in family) on a home LAN — usually Brad managing Plex + Usenet from phone/desktop. Context: “is the library healthy, what’s missing, what’s wasting disk?” Sessions are short ops bursts, not browsing.

## Product Purpose

TV Orchestrator (“orca”) turns a Proxmox media stack into a simple request → grab → import loop, plus library inventory, gap fills, and stale cleanup. Success is: find a show, get it into Plex without SSH, and reclaim disk from unwatched junk without surprises.

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
