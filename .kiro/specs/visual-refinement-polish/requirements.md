# Requirements Document

## Introduction

This feature refines the **visual formatting** of the PlannerDuo frontend so the interface reads as more pleasant and professional, **without changing the existing "AgendaCar" color palette or the overall layout**. The owner deliberately built the current look (color tokens and structure in `public/style.css`) and wants it preserved exactly. Work is strictly limited to formatting quality: spacing rhythm, a coherent type scale, consistent border-radius and shadow usage, alignment, whitespace balance, visual hierarchy, and hover/focus/transition polish.

The refinement is expressed as a small set of **additive, non-breaking design tokens** (a 4px spacing scale and a type scale) plus **targeted value adjustments** to existing rules. Every color value and every layout-defining property stays identical. The only file changed is `public/style.css`; the markup files (`public/index.html`, `public/app.html`, `public/auth.html`) are read-only references.

## Glossary

- **Stylesheet**: The single source of change, `public/style.css`.
- **Color_Token**: Any `:root` custom property whose value is a color (`#hex`, `rgb`/`rgba`, named color, `linear-gradient`, or a `var()` pointing at a color token) — includes the `--ac-*` palette and all derived `--bg`/`--surface*`/`--accent*`/`--primary*`/`--green`/`--red`/`--info`/`--purple` mappings.
- **Color_Literal**: Any distinct hex or `rgba` color value appearing in the Stylesheet.
- **Layout_Geometry**: The structural declarations that define page layout — `--sidebar-width` (`280px`), `.app-shell` `display: flex`, `.app-main` `margin-left: var(--sidebar-width)`, `main` `max-width: 1280px`, grid `grid-template-columns` track counts, and the `@media (max-width: 900px)` and `@media (max-width: 600px)` breakpoints.
- **Spacing_Scale**: Additive `:root` tokens `--space-1` through `--space-8` on a 4px base rhythm.
- **Type_Scale**: Additive `:root` tokens `--fs-xs` through `--fs-3xl` with line-height (`--lh-*`) and letter-spacing (`--tracking-*`) companions.
- **Baseline_Snapshot**: The captured color and geometry state of the on-disk `public/style.css` taken before the refinement, used as the authority for invariance checks.
- **Markup_Files**: `public/index.html`, `public/app.html`, `public/auth.html` — read-only references, never edited.

## Requirements

### Requirement 1: Preserve the color palette

**User Story:** As the application owner, I want the AgendaCar color palette kept exactly as is, so that the brand look I designed is untouched by the formatting refinement.

#### Acceptance Criteria

1. THE Stylesheet SHALL keep the resolved value of every Color_Token equal to its value in the Baseline_Snapshot.
2. WHERE a derived color mapping (such as `--bg`, `--surface`, `--accent`, `--primary`, `--green`, `--red`, `--info`, `--purple`) exists, THE Stylesheet SHALL keep that mapping's resolved value equal to its value in the Baseline_Snapshot.
3. THE Stylesheet SHALL preserve every existing gradient stop and `rgba()` alpha-over-color value without modification.

### Requirement 2: Introduce no new colors

**User Story:** As the application owner, I want no new colors added, so that the refinement cannot drift my palette.

#### Acceptance Criteria

1. THE Stylesheet SHALL keep the set of distinct Color_Literals as a subset of the set present in the Baseline_Snapshot.
2. WHEN a formatting value is adjusted, THE Stylesheet SHALL reuse only Color_Literals that already exist in the Baseline_Snapshot.

### Requirement 3: Preserve layout geometry

**User Story:** As the application owner, I want the layout structure I built kept exactly, so that only visual formatting changes and nothing moves.

#### Acceptance Criteria

1. THE Stylesheet SHALL keep `--sidebar-width` equal to `280px`.
2. THE Stylesheet SHALL keep `.app-shell` set to `display: flex`.
3. THE Stylesheet SHALL keep `.app-main` set to `margin-left: var(--sidebar-width)`.
4. THE Stylesheet SHALL keep `main` set to `max-width: 1280px`.
5. THE Stylesheet SHALL preserve the `@media (max-width: 900px)` and `@media (max-width: 600px)` breakpoints.
6. THE Stylesheet SHALL keep every `grid-template-columns` definition at its Baseline_Snapshot track count.

### Requirement 4: Avoid fixed wide-width regressions

**User Story:** As the application owner, I want responsiveness preserved, so that the refinement does not introduce a fixed wide element that breaks the layout.

#### Acceptance Criteria

1. THE Stylesheet SHALL ensure no non-decorative rule outside an `@media` block declares a `width` of 360px or greater.

### Requirement 5: Preserve the typographic floor

**User Story:** As a reader of the interface, I want text to stay legible, so that the type-scale refinement never renders text too small.

#### Acceptance Criteria

1. THE Stylesheet SHALL keep every resolvable fixed `font-size` at 13px or greater.
2. WHEN the Type_Scale is applied to a selector, THE Stylesheet SHALL use a token whose resolved size is 13px or greater.

### Requirement 6: Keep all resources local

**User Story:** As the application owner, I want the UI to stay fully self-hosted, so that no external resource is pulled in during the refinement.

#### Acceptance Criteria

1. THE Stylesheet SHALL contain no `@import` statement.
2. THE Stylesheet SHALL contain no remote `url(http...)` reference, CDN reference, or remote font-host reference.
3. THE Stylesheet SHALL contain no remote `@font-face` source.

### Requirement 7: Define and apply formatting scale tokens

**User Story:** As the application owner, I want the formatting expressed through consistent scales, so that spacing, type, radius, shadow, and interaction rhythm feel intentional and professional.

#### Acceptance Criteria

1. THE Stylesheet SHALL define `--space-1` through `--space-8` on a 4px base rhythm in `:root`.
2. THE Stylesheet SHALL define `--fs-xs` through `--fs-3xl` in `:root`, with line-height (`--lh-*`) and letter-spacing (`--tracking-*`) companion tokens.
3. WHEN a padding, margin, or gap literal is refined, THE Stylesheet SHALL reference a Spacing_Scale token.
4. WHEN a `font-size` is refined, THE Stylesheet SHALL reference a Type_Scale token.
5. THE Stylesheet SHALL reference the Spacing_Scale and Type_Scale tokens in a count that exceeds the Baseline_Snapshot threshold of former literals, demonstrating the refinement was applied rather than only declared.
6. THE Stylesheet SHALL apply the existing `--radius-*` tokens so that controls, containers, and pills each use a consistent corner step.
7. THE Stylesheet SHALL apply the existing `--shadow-*` tokens so that resting cards and floating surfaces each use a consistent elevation step.
8. THE Stylesheet SHALL apply the existing `--t-fast`/`--t-base`/`--t-slow` tokens to hover, active, and focus transitions.

### Requirement 8: Retain accessibility affordances

**User Story:** As a keyboard and reduced-motion user, I want accessibility features kept, so that the refinement does not degrade usability.

#### Acceptance Criteria

1. THE Stylesheet SHALL retain the `--focus-ring` token and `:focus-visible` focus styling.
2. WHERE a `prefers-reduced-motion` block exists, THE Stylesheet SHALL retain it.
3. WHERE an `@supports` or backdrop-filter fallback exists, THE Stylesheet SHALL retain it.

### Requirement 9: Limit the change surface

**User Story:** As the application owner, I want the change confined to the stylesheet, so that markup and behavior are not disturbed.

#### Acceptance Criteria

1. THE Stylesheet SHALL be the only file modified by this feature.
2. THE Markup_Files SHALL remain unchanged and serve only as read-only selector references.
