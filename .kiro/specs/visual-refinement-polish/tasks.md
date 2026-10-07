# Implementation Plan: Visual Refinement & Polish

## Overview

All work is confined to `public/style.css`. The HTML files (`public/index.html`, `public/app.html`, `public/auth.html`) are read-only selector references and MUST NOT be edited. Language is CSS plus `vitest` for verification (existing test stack, no new dependencies).

Order is incremental: capture a baseline snapshot of the real on-disk palette/geometry → add additive scale tokens → apply spacing scale → apply type scale → radius/shadow consistency → state/transition polish → tests covering all 8 correctness properties. Each applied edit keeps every color token and layout-geometry declaration identical to the baseline.

## Tasks

- [x] 1. Capture baseline snapshot of current `public/style.css`
  - [x]* 1.1 Add `tests/ui/_baseline-style.js` helper that captures the on-disk baseline
    - Parse `:root` and extract a `name → value` map for every declaration whose value matches a color pattern (`#hex`, `rgb(a)`, named color, `linear-gradient`, or `var()` pointing at a color token)
    - Capture the set of distinct color literals in the file
    - Capture layout-geometry declarations: `--sidebar-width`, `.app-shell` `display`, `.app-main` `margin-left`, `main` `max-width`, presence of the 900px/600px breakpoints, and every `grid-template-columns` track count
    - Baseline MUST reflect the real AgendaCar palette (`#1e3a8a`, `#f28a1e`, `#74d2e7`, `#234796`, `#e07712`, `#c45500`, etc.), NOT the legacy literals (`#27c0d4`, `#070a12`, `#3a5bd0`) asserted in `tests/ui/tokens.test.js`
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
    - _Supports: Property 1, Property 2, Property 3_

- [ ] 2. Add additive scale tokens to `:root` (no color token touched)
  - [~] 2.1 Define spacing and type scale tokens inside the existing `:root`
    - Add `--space-1: 4px` through `--space-8: 40px` on a 4px base rhythm
    - Add `--fs-xs: 0.8125rem` (13px floor) through `--fs-3xl: 2.2rem`, plus `--lh-tight/--lh-base/--lh-relaxed` and `--tracking-tight/--tracking-wide`
    - Append only; do not modify, reorder, or remove any `--ac-*` or derived color token, nor any `--radius-*`/`--shadow-*`/`--t-*`/`--focus-ring`/`--sidebar-width` declaration
    - _Requirements: 7.1, 7.2, 5.1, 5.2_
    - _Supports: Property 5, Property 7_

- [~] 3. Checkpoint - tokens defined, palette/geometry still intact
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Apply the spacing scale to padding/margin/gap literals
  - [~] 4.1 Snap spacing in structural containers (views, panels, sidebar nav)
    - Replace padding/margin/gap literals in `.view`, `.panel`, `.compact-panel`, `.sidebar`, `.nav-list`, `.nav-item`, `.sidebar-footer` with `--space-*` tokens
    - Keep `--sidebar-width`, `.app-shell { display: flex }`, `.app-main { margin-left: var(--sidebar-width) }`, and the `.nav-item` orange pressed-button motif (border, bg, `box-shadow` offsets) unchanged
    - _Requirements: 7.3, 3.1, 3.2, 3.3_
    - _Supports: Property 3, Property 7_
  - [~] 4.2 Snap spacing in headers, dashboard, tables, forms
    - Replace padding/margin/gap literals in `.app-topbar`, `.mobile-header`, `.page-heading`, `.panel-heading`, `.hero-card`, `.metric-grid`, `.metric-card`, `table`/`th`/`td`, `input`/`select`/`textarea`/`label`/`.form-grid` with `--space-*` tokens
    - Do not alter any `grid-template-columns` track count or `width` values
    - _Requirements: 7.3, 3.6, 4.1_
    - _Supports: Property 4, Property 7_
  - [~] 4.3 Snap spacing in buttons, cards, dialogs/toast, landing/auth
    - Replace padding/margin/gap literals in `.button`, `.icon-button`, `.entity-card`, `.card-grid`, `.dialog`/`.dialog-header`/`.dialog-actions`, `.toast`, `.landing-*`, `.vault-auth-*` with `--space-*` tokens
    - _Requirements: 7.3_
    - _Supports: Property 7_

- [ ] 5. Apply the type scale to headings and text
  - [~] 5.1 Replace `font-size` literals with Type_Scale tokens + line-height/letter-spacing
    - Map headings/text (`.page-heading h1`, `.panel-heading h2`, `.brand-copy`, metric values/labels, table headers, body/secondary text) to `--fs-*` with matching `--lh-*` and, for large headings/uppercase labels, `--tracking-*`
    - Every applied token MUST resolve to >= 13px (use `--fs-xs` as the floor); never drop a size below 13px
    - _Requirements: 7.4, 5.1, 5.2_
    - _Supports: Property 5, Property 7_

- [ ] 6. Radius & shadow consistency pass (existing tokens only, no new values)
  - [~] 6.1 Apply consistent radius and elevation steps
    - Controls (`.button`, `.icon-button`, inputs, `.toast`) → `--radius-sm`; containers (`.panel`, `.view`, `.entity-card`, `.metric-card`, `.hero-card`, `.dialog`) → `--radius-lg`; pills/badges (`.status-pill`, `.nav-item b`) → `--radius-pill`
    - Resting cards → `--shadow-sm`; floating surfaces (`.dialog`, `.toast`) → `--shadow`/`--shadow-lg`; introduce no literal `box-shadow` color/offset values beyond the preserved `.nav-item` motif
    - _Requirements: 7.6, 7.7, 2.1, 2.2_
    - _Supports: Property 2, Property 7_

- [ ] 7. State & transition polish (existing `--t-*` tokens)
  - [~] 7.1 Normalize hover/active/focus transitions
    - Apply `--t-fast`/`--t-base`/`--t-slow` to hover/active/focus transitions across buttons, nav items, inputs, cards; keep the `.nav-item` translate+shadow pressed-button motif, only normalizing its timing
    - Retain the `--focus-ring` token and `:focus-visible` styling, the `prefers-reduced-motion` block, and any `@supports`/backdrop-filter fallback exactly as-is
    - _Requirements: 7.8, 8.1, 8.2, 8.3_
    - _Supports: Property 8_

- [~] 8. Checkpoint - all scales applied, palette/geometry unchanged
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Verification tests (cover all 8 correctness properties)
  - [~]* 9.1 Add `tests/ui/visual-refinement.test.js` for snapshot invariance + scale usage
    - **Property 1: Palette invariance** — assert the `:root` color `name → value` map equals the captured baseline. **Validates: Requirements 1.1, 1.2, 1.3**
    - **Property 2: No new colors introduced** — assert the set of distinct color literals after refinement is a subset of the baseline set. **Validates: Requirements 2.1, 2.2**
    - **Property 3: Layout geometry invariance** — assert `--sidebar-width: 280px`, `.app-shell { display: flex }`, `.app-main { margin-left: var(--sidebar-width) }`, `main { max-width: 1280px }`, both breakpoints present, and every `grid-template-columns` track count equals baseline. **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
    - **Property 7: Scale tokens present and referenced** — assert `:root` defines `--space-1..8` and `--fs-xs..3xl`, and that counts of `var(--space-` and `var(--fs-` references exceed a baseline threshold. **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8**
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  - [~]* 9.2 Extend `tests/ui/tokens.test.js` for floor, local resources, and token/a11y presence
    - **Property 5: Typographic floor preserved** — reuse `collectFontSizes`; assert min resolvable fixed `font-size` >= 12.9px (target 13px). **Validates: Requirements 5.1, 5.2**
    - **Property 6: Resources stay local** — reuse the "recursos 100% locais" checks (no `@import`, no remote `url(http...)`, no CDN/font host, no remote `@font-face`). **Validates: Requirements 6.1, 6.2, 6.3**
    - **Property 8: Accessibility affordances retained** — assert `--focus-ring` and `:focus-visible` present and the `prefers-reduced-motion` / `@supports` fallback blocks are not removed. **Validates: Requirements 8.1, 8.2, 8.3**
    - Reconcile the existing palette assertions with the real on-disk AgendaCar baseline so legacy literals (`#27c0d4`/`#070a12`/`#3a5bd0`) do not cause false failures
    - _Requirements: 5.1, 5.2, 6.1, 6.2, 6.3, 8.1, 8.2, 8.3_
  - [~]* 9.3 Extend `tests/ui/layout-audit.test.js` for wide-width and breakpoint guards
    - **Property 4: No fixed wide width regression** — reuse `offendingWidths`; assert no non-decorative rule outside `@media` declares `width >= 360px`. **Validates: Requirement 4.1**
    - Reuse the breakpoint-presence checks for `@media (max-width: 900px)` and `@media (max-width: 600px)` (reinforces Property 3)
    - _Requirements: 4.1, 3.5_

- [~] 10. Final checkpoint - run the full suite
  - Ensure all tests pass (`vitest`), ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test-authoring sub-tasks; they can be skipped for a faster MVP but are what the execution agent runs with `vitest` to confirm the refinement.
- The only file modified by implementation tasks is `public/style.css`; the three HTML files stay unchanged (_Requirements: 9.1, 9.2_).
- The authoritative baseline is the present on-disk `public/style.css`, captured in task 1 — not the legacy literals in the existing `tokens.test.js`.
- Every applied edit changes only formatting properties (padding, margin, gap, `border-radius`, `box-shadow`, `font-size`, `line-height`, `letter-spacing`, `font-weight`, transition timing); colors and layout geometry are frozen.
- All 8 correctness properties from `design.md` are covered: P1/P2/P3/P7 in task 9.1, P5/P6/P8 in task 9.2, P4 in task 9.3.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["6.1"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["9.1", "9.2", "9.3"] }
  ]
}
```
