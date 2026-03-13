# ADR-005: Dark-Mode-First Design System

## Status: Accepted

## Context
Dashboard for reviewing government contracts needs to be information-dense, professional, and comfortable for extended use.

## Decision
Dark-mode-first design system inspired by Bloomberg Terminal meets Linear.app:
- CSS variable semantic tokens in `globals.css` (`:root` light + `.dark` class)
- `darkMode: 'class'` in Tailwind config
- Flash-free init via inline `<script>` in layout.tsx (reads localStorage before paint)
- All colors via tokens: `--surface`, `--text-primary`, `--good`, `--maybe`, `--discard`, `--pending`, `--urgent`, `--accent`
- Never hardcode Tailwind color classes (`bg-white`, `text-gray-*`)

## Classification Color Scheme
- Green (#10b981) = GOOD
- Amber (#f59e0b) = MAYBE
- Slate (#64748b) = DISCARD
- Blue (#3b82f6) = PENDING
- Red (#ef4444) = Urgent deadlines

## Consequences
- Consistent theming across all components
- Easy to add new themes (just add CSS variable set)
- All new components must use `var(--token)` pattern
