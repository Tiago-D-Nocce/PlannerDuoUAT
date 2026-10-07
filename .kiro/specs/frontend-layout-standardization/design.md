# Frontend Layout Standardization Bugfix Design

## Overview

Several components rendered in the PlannerDuo markup have no matching CSS rules in `public/style.css`, so the browser renders them with raw user-agent defaults. The affected components are the local account profile block (`.local-account-chip`), the password field wrapper (`.password-field` with its embedded `[data-toggle-password]` button), the secondary navigation links (`.auth-text-action`), the consent control (`.auth-agreement`), the recovery notice (`.recovery-warning`), the recovery actions group (`.auth-recovery-actions`), and the two-column setup grid (`.form-grid.two`). The missing styling produces cramped profile blocks, toggle buttons floating below their inputs, a consent checkbox detached from its text, link-buttons that look like raw bordered controls, a truncated placeholder, and inconsistent spacing between the recovery warnings and actions.

The fix is additive and targeted: add the missing CSS rules and correct the handful of selectors that produce misalignment, so each component renders with the standardized card/input/button styling that already exists for the rest of the app. The fix is strictly scoped to `public/style.css`. No markup changes are required because every component already has the correct class names and semantic structure; only their styling is missing. The fix reuses the existing palette tokens (`--ac-dark-blue #1e3a8a`, `--ac-orange #f28a1e`, grays, white) and radius tokens (`--radius-sm 6px`, `--radius 8px`) exactly as defined in `:root` — no color value or token is added, removed, or changed.

A latent consequence of the missing rules is that `.auth-state` has no `display` rule, even though `auth.js` toggles an `.active` class to switch between the loading / unlock / setup / recovery states. The design adds the `.auth-state` / `.auth-state.active` display rules so the existing state-transition behavior renders as a single visible card at a time, exactly as the JS already intends.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a component is rendered whose styling is missing, inconsistent, or misaligned relative to the standardized design (unstyled profile block, floating password toggle, raw link-buttons, detached consent checkbox, unstyled recovery notice/actions, or a non-stacking two-column grid).
- **Property (P)**: The desired behavior — the component renders with the standardized card/input/button/text-link styling, aligned, responsive, and using only existing palette and radius tokens.
- **Preservation**: Existing behavior that must remain unchanged — the palette tokens, 100%-local resources, the ≥13px font-size floor, the unlock/setup/recovery state transitions, the password visibility toggle, the password strength indicator, the "APAGAR" destroy-vault confirmation, existing accessibility semantics, and all already-correct layouts.
- **`.vault-auth-card`**: The centered card container in `auth.html` that holds each auth state. Already styled (`max-width: 480px`, `padding: 40px`, `border-radius: var(--radius-lg)`).
- **`.auth-state`**: A single auth screen (`#auth-loading`, `#auth-unlock`, `#auth-setup`, `#auth-recovery`). `auth.js` adds/removes the `.active` class to show exactly one at a time via `showView()`.
- **`.local-account-chip`**: The unlock-screen profile block: an avatar `<span>` plus a `<div>` holding the account name (`<strong>`) and email (`<small>`). Currently unstyled.
- **`.password-field`**: The wrapper `<div>` around a password `<input>` and its `[data-toggle-password]` visibility button. Currently unstyled, so the button renders below the input.
- **`.auth-text-action`**: The secondary navigation `<button>` ("Primeiro acesso? Crie sua conta" / "Já tem conta? Entrar"). Currently renders as a raw default button.
- **`.auth-agreement`**: The setup consent `<label>` wrapping a checkbox `<input>` and a text `<span>`. Currently renders the checkbox detached from its text.
- **`.recovery-warning`**: The recovery "Último recurso" notice block (`<strong>` + `<p>`). Currently unstyled.
- **`.auth-recovery-actions`**: The recovery actions group holding "Voltar ao login" and "Apagar e recomeçar" buttons. Currently unstyled.
- **`.form-grid.two`**: The two-column setup grid holding the "Seu nome" and "E-mail local" fields. Styled as `grid-template-columns: 1fr 1fr` but never stacks on small screens.

## Bug Details

### Bug Condition

The bug manifests when any of the enumerated auth components is rendered on `index.html`, `auth.html`, or `app.html`. The affected selectors either have **no** rule in `public/style.css` (so they fall back to raw browser defaults) or have a rule that is incomplete for small viewports. Because the components carry no styling, they inherit block/inline defaults that break alignment, spacing, and embedding.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type RenderedComponent  // a component rendered on any system page
  OUTPUT: boolean

  RETURN input.isProfileBlock              // .local-account-chip
      OR input.isPasswordField             // .password-field + [data-toggle-password]
      OR input.isInput                     // standardized input incl. "APAGAR" field
      OR input.isPrimaryButton             // .button.primary.vault-submit
      OR input.isSecondaryTextLink         // .auth-text-action
      OR input.isConsentCheckbox           // .auth-agreement
      OR input.isRecoveryNoticeOrAction    // .recovery-warning / .auth-recovery-actions / .vault-raw-download
      OR input.isAuthCardContainer         // .vault-auth-card / .auth-state
      OR input.hasInconsistentRadiusOrSpacingOrTypography
END FUNCTION
```

### Examples

- **Profile block (`.local-account-chip`)**: The avatar initials, name, and email stack as raw inline/block content with no avatar circle, no spacing, and no name/email hierarchy. Expected: a circular gray avatar on the left with the name (bold) and email (regular, smaller) stacked to its right.
- **Password field (`.password-field`)**: The `◉` toggle button renders on its own line below the input. Expected: the input reserves right-side padding and the toggle sits embedded inside the field, right-aligned and vertically centered.
- **Secondary link (`.auth-text-action`)**: "Primeiro acesso? Crie sua conta" renders as a raw default button with a border and gray background. Expected: a borderless dark-blue text link with a hover underline.
- **Consent checkbox (`.auth-agreement`)**: The checkbox and its sentence render on separate lines, detached. Expected: a flex row with the checkbox aligned to the first text line and an 8–12px gap.
- **Two-column grid placeholder (`.form-grid.two`)**: On a narrow viewport the "Como devemos chamar você?" placeholder is truncated because the two columns never stack. Expected: the placeholder is fully visible and the columns stack to a single column on small screens.
- **Edge case — auth state visibility (`.auth-state`)**: With no `display` rule, every auth state could render at once. Expected: only the `.active` state is visible, matching the `showView()` toggle in `auth.js`.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The existing palette tokens and radius tokens in `:root` remain byte-for-byte unchanged; no new color values are introduced.
- All resources remain 100% local — no `@import`, no remote `url(http...)`, no font CDN, no remote `@font-face`.
- Every fixed `font-size` stays at or above the 13px floor enforced by `tests/ui/tokens.test.js`.
- The unlock / setup / recovery state transitions, the password visibility toggle, the password strength indicator, and the "APAGAR" destroy-vault confirmation continue to behave exactly as before (no JS changes).
- Existing semantic structure, labels, `aria-live` regions, and `:focus-visible` behavior are preserved or improved.
- Screens and components that already render correctly (landing hero, app shell, sidebar, dashboard, dialogs, tables) are not restyled and keep their current layout.

**Scope:**
All inputs that are NOT one of the enumerated unstyled/misaligned auth components should be completely unaffected by this fix. This includes:
- The landing page hero, features, and navigation on `index.html`.
- The application shell, sidebar, dashboard, panels, tables, and dialogs on `app.html`.
- Already-styled auth pieces: `.vault-auth-card`, `.auth-state-heading`, the global `input`/`.button` rules, `.form-grid` base, and the existing 900px/600px breakpoints.

**Note:** The actual expected correct behavior for buggy inputs is defined in the Correctness Properties section (Property 1). This section focuses on what must NOT change.

## Hypothesized Root Cause

Based on the bug description and confirmed by reading `public/style.css`, the cause is **missing CSS rules**, not incorrect logic. The specific causes are:

1. **Selectors with no rule at all**: `.local-account-chip`, `.password-field`, `.auth-text-action`, `.auth-agreement`, `.recovery-warning`, `.auth-recovery-actions`, `.vault-form`, `.vault-submit`, `.auth-security-hint`, and `.auth-inline-status` are referenced in the markup but have zero declarations in the stylesheet, so they render with user-agent defaults.
   - `.password-field` has no `position`/flex context, so its toggle button is not embedded.
   - `.auth-text-action` inherits default `<button>` chrome (border, background), so it looks like a bordered control instead of a text link.
   - `.local-account-chip` has no flex layout or avatar styling, so the avatar/name/email collapse together.

2. **Missing auth-state visibility rule**: `.auth-state` has no `display: none` and `.auth-state.active` has no `display: block`, even though `auth.js` toggles `.active`. Without these rules the states cannot be shown/hidden purely by CSS.

3. **Incomplete responsive rule for the two-column grid**: `.form-grid.two { grid-template-columns: 1fr 1fr }` exists but is never overridden inside the 600px breakpoint, so the two columns never stack and the placeholder is truncated on narrow screens.

4. **Consistency gaps**: The standardized `input` and `.button` rules already exist, but the newly styled components must opt into the same `--radius-sm`/`--radius` radii, ~12px input padding, and typography so the whole auth surface is consistent.

## Correctness Properties

Property 1: Bug Condition - Standardized, Aligned, Palette-Preserving Rendering

_For any_ rendered component where the bug condition holds (isBugCondition returns true), the fixed stylesheet SHALL render that component with the standardized design: the auth card centered at a 450–500px standard width with standardized internal padding and vertical spacing; the password toggle embedded inside the input and right-aligned (never floating below); the profile block laid out as a circular gray avatar on the left with the name in bold and the email in a regular smaller weight stacked beside it; the consent checkbox inline with its text via a flex row; secondary navigation rendered as clean borderless dark-blue text links; primary buttons full-width with centered typography and inline icons; the "Seu nome" placeholder fully visible with the two-column grid stacking on small devices; standardized input styling (6–8px radius, ~12px padding, soft gray border, existing focus token) applied including the "APAGAR" field; a standardized 8px corner radius and consistent typography; and using only the existing palette and radius tokens.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11**

Property 2: Preservation - Non-Buggy Inputs Behave Identically

_For any_ rendered component where the bug condition does NOT hold (isBugCondition returns false), the fixed stylesheet SHALL produce the same result as the original stylesheet, preserving the existing palette tokens, the 100%-local resource policy, the ≥13px font-size floor, the unlock/setup/recovery state transitions, the password toggle / strength indicator / destroy-vault behavior, existing accessibility semantics, and all already-correct landing, app-shell, and auth layouts.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, all changes are additive CSS in a single file. No markup or JavaScript changes.

**File**: `public/style.css`

**Approach**: Add a dedicated "Auth components (standardization)" block near the existing `/* ===== Auth Page ===== */` section, and extend the existing `@media (max-width: 600px)` block for the grid stacking. All new rules reference only existing tokens.

**Specific Changes**:

1. **Auth card container and state visibility (2.1)**:
   - Reaffirm the centered card standard width using the existing `.vault-auth-card` rule (`max-width: 480px`, within the required 450–500px band) and standardized `padding: 40px`.
   - Add `.auth-state { display: none; }` and `.auth-state.active { display: block; }` so exactly one state shows, matching `auth.js` `showView()`. Standardize vertical spacing between internal sections with a consistent gap/margin (e.g. the `.vault-form` uses `display: grid; gap`), reusing `--radius`/spacing conventions already present.

2. **Profile block — `.local-account-chip` (2.2)**:
   - `display: flex; align-items: center; gap: 12px;` with top/bottom margin for separation.
   - Avatar `<span>`: fixed circular size (e.g. 44px), `border-radius: var(--radius-pill)`, soft gray background (existing `--surface-3`/gray token), centered initials, bold.
   - `strong` (name): bold, `--text`. `small` (email): regular weight, smaller size (≥13px via rem), `--muted`, stacked beneath the name.

3. **Password field — `.password-field` (2.3)**:
   - `position: relative; display: flex; align-items: center;`.
   - The inner `input` keeps the global input style but reserves right padding (e.g. `padding-right: 44px`) so text never sits under the toggle.
   - The `[data-toggle-password]` button: `position: absolute; right: 8px;` (or flex, right-aligned), transparent background, no border, pointer cursor, `--muted`/`--ac-dark-blue` icon color, so it is embedded and right-aligned. It must NOT render below the field.

4. **Standardized inputs incl. "APAGAR" (2.4, 2.11)**:
   - Confirm the existing global `input, select, textarea` rule already provides the standardized style: `border-radius: var(--radius-sm)` (6px, within the 6–8px band), `padding: 14px 16px` (~12px band), a soft gray border, and the focus state via `--ac-orange`. The "APAGAR" confirmation input inherits this automatically. Ensure no new per-field overrides reintroduce inconsistency.

5. **Two-column grid stacking — `.form-grid.two` (2.5)**:
   - Keep `grid-template-columns: 1fr 1fr` at desktop. In `@media (max-width: 600px)` add `.form-grid.two { grid-template-columns: 1fr; }` so the "Seu nome" and "E-mail local" fields stack and the placeholder "Como devemos chamar você?" is fully visible.

6. **Primary buttons — `.button.primary.vault-submit` (2.6)**:
   - The global `.button` already provides inline-flex, centered typography, inline icon gap, and `--ac-orange`. Add `.vault-submit { width: 100%; }` for full-width submit buttons with generous vertical padding (reuse the existing `padding: 12px 24px`, within the 12–14px band). Icons (`↗`, `⌗`) stay inline via the existing `gap: 8px`.

7. **Secondary text links — `.auth-text-action` (2.7)**:
   - `background: transparent; border: none; padding: 0;` block-centered, `color: var(--ac-dark-blue)`, pointer cursor, font-size ≥13px.
   - `:hover` / `:focus-visible`: subtle underline or opacity change; keep `:focus-visible` outline from the global token.

8. **Consent checkbox — `.auth-agreement` (2.8)**:
   - Override the default `label { display: grid }` with `display: flex; align-items: flex-start; gap: 10px;` so the checkbox sits at the top-left of the first text line.
   - The `input[type="checkbox"]` gets a fixed small size and `width: auto` (so it does not stretch to the full-width input rule), with an adequate right gap. The `<span>` text stays regular weight, left-aligned.

9. **Recovery notice/actions — `.recovery-warning`, `.auth-recovery-actions`, `.vault-raw-download` (2.9, 2.10)**:
   - `.recovery-warning`: a legible notice block with padding, `border-radius: var(--radius)`, a very light gray/blue-gray background (existing `--surface-2`/`--surface-3`), the `<strong>` title bold and the `<p>` regular; clear bottom margin to separate warnings from actions.
   - `.auth-recovery-actions`: `display: flex; gap; justify-content;` to align the "Voltar ao login" and "Apagar e recomeçar" buttons.
   - `.vault-raw-download`: aligned ghost/text-link treatment reusing `.button.ghost`.

10. **Supporting text — `.auth-security-hint`, `.auth-inline-status`, `.auth-back-link` (2.11)**:
    - Give these consistent `--muted` color, centered/legible alignment, and ≥13px size so titles (bold) and supporting text (regular) are visually consistent across states.

**Token discipline**: every declaration references existing tokens only (`--ac-dark-blue`, `--ac-orange`, `--ac-orange-hover`, grays such as `--surface-2`/`--surface-3`/`--muted`/`--line`, `--ac-white`, `--radius-sm`, `--radius`, `--radius-pill`, `--focus-ring`). No literal color hex values are added outside what already exists.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix renders the components correctly and preserves existing behavior. Because this is a static HTML/CSS surface validated without a browser, the primary regression guards are the existing suites `tests/ui/tokens.test.js` and `tests/ui/layout-audit.test.js`, complemented by targeted assertions that each previously-missing selector now has a rule.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis (missing CSS rules). If refuted, re-hypothesize.

**Test Plan**: Parse `public/style.css` from disk and assert that each affected selector currently has NO rule, and that `.form-grid.two` is not overridden inside the 600px breakpoint. Run on the UNFIXED stylesheet to observe the failures that confirm the components fall back to defaults.

**Test Cases**:
1. **Missing profile rule**: Assert `.local-account-chip` has no declaration block (will fail to find styling on unfixed code).
2. **Missing password-field rule**: Assert `.password-field` has no positioning/flex rule, confirming the toggle cannot be embedded (will fail on unfixed code).
3. **Missing text-link rule**: Assert `.auth-text-action` has no rule, confirming it renders as a default button (will fail on unfixed code).
4. **Edge case — non-stacking grid**: Assert the 600px breakpoint does not contain `.form-grid.two`, confirming the placeholder truncates on narrow screens (will fail on unfixed code).

**Expected Counterexamples**:
- The enumerated selectors resolve to zero declarations.
- Possible causes: selectors never authored, auth section incomplete, responsive override missing. (Confirmed: all three.)

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed stylesheet produces the expected standardized behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  render := fixedStylesheet(input)
  ASSERT expectedBehavior(render)
    // card width in [450px, 500px]; radius in {6px, 8px}; input padding ~12px;
    // password toggle embedded & right-aligned; profile = avatar-left + name(bold)/email(regular);
    // consent checkbox inline with text; secondary link = clean text link;
    // primary button = full-width, centered, inline icon; placeholder fully visible;
    // uses only existing palette tokens
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed stylesheet produces the same result as the original stylesheet.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalStylesheet(input) = fixedStylesheet(input)
  // palette tokens, local-only resources, >=13px font floor, auth state
  // transitions, toggle/strength/destroy behavior, and already-correct
  // landing/app/auth layouts are all unchanged.
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (e.g. all font-size declarations, all `url(...)` references).
- It catches edge cases that manual unit tests might miss.
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs.

The two existing suites already encode the strongest preservation invariants and act as the regression gate: `tests/ui/tokens.test.js` (palette tokens present, no remote resources, ≥13px floor, focus ring) and `tests/ui/layout-audit.test.js` (no "cofre/vault" copy, 900px/600px breakpoints present, no fixed width ≥360px outside `@media` in non-decorative rules, every button named, decorative icons `aria-hidden`). New rules must not break any of these.

**Test Plan**: Run both existing suites on the UNFIXED code to establish the green baseline, apply the fix, then re-run to confirm they stay green. Add targeted assertions capturing the pre-fix state for non-buggy components and confirm it is unchanged after the fix.

**Test Cases**:
1. **Palette preservation**: Observe `#1e3a8a`, `#f28a1e`, `#74d2e7`, `#f23c13` and all `:root` tokens present on unfixed code; assert still present and unchanged after fix (guarded by `tokens.test.js`).
2. **Local-resource & font-floor preservation**: Observe no remote resources and all font-sizes ≥13px on unfixed code; assert unchanged after fix (guarded by `tokens.test.js`).
3. **Layout-audit preservation**: Observe no fixed width ≥360px outside `@media`, both breakpoints present, all app buttons named on unfixed code; assert unchanged after fix (guarded by `layout-audit.test.js`). The new `.form-grid.two` stacking override lives inside the 600px `@media`, so it must not introduce a non-media fixed width.
4. **Behavior preservation**: Confirm no changes to `auth.js`/`local.js`, so the state transitions, password toggle, strength indicator, and destroy-vault confirmation are untouched.

### Unit Tests

- Assert each previously-missing selector (`.local-account-chip`, `.password-field`, `.auth-text-action`, `.auth-agreement`, `.recovery-warning`, `.auth-recovery-actions`) now has a rule block in `public/style.css`.
- Assert `.auth-state` has `display: none` and `.auth-state.active` has `display: block`.
- Assert `.password-field` establishes a positioning/flex context and its toggle button is absolutely positioned/right-aligned.
- Assert `.form-grid.two` is overridden to a single column inside `@media (max-width: 600px)`.
- Assert the new rules reference only `var(--...)` tokens or existing palette values (no new hex colors).

### Property-Based Tests

- Over all `font-size` declarations in the stylesheet, assert every fixed value resolves to ≥13px (reuses the `tokens.test.js` collector approach, now including the new rules).
- Over all top-level (non-`@media`) rules, assert no non-decorative rule declares a fixed `width ≥ 360px` (reuses the `layout-audit.test.js` approach, now including the new rules).
- Over all `url(...)` and `@import` occurrences, assert none are remote after the fix.

### Integration Tests

- Render-oriented check across the three pages (`index.html`, `auth.html`, `app.html`): confirm the stylesheet parses and the auth card shows one `.auth-state` at a time when `.active` is applied (DOM harness in `tests/helpers/mini-dom.mjs`).
- Confirm the full auth flow markup (unlock → setup → recovery) maps each state to styled components with the standardized card, embedded toggle, inline consent, and aligned recovery actions.
- Confirm switching states via the `data-auth-view` buttons continues to resolve to a single visible, fully-styled card.
