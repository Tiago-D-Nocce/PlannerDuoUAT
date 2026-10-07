# Bugfix Requirements Document

## Introduction

The frontend of PlannerDuo exhibits widespread layout, alignment, spacing, and UX defects across the landing page (`index.html`), the authentication page (`auth.html`) and its states (unlock / setup / recovery), and the application shell (`app.html`). Several components rendered in the markup have no corresponding CSS rules (for example `local-account-chip`, `password-field`, `auth-text-action`, `auth-agreement`, `recovery-warning`, `auth-recovery-actions`, `form-grid.two`), so they fall back to raw browser defaults. The result is cramped profile blocks, password toggle buttons floating outside their input fields, text-less/misaligned checkboxes, action links that look like raw tables or old HTML borders, truncated placeholders, inconsistent container widths, and arbitrary padding/margins.

This bug fix standardizes the frontend to a professional, enterprise-grade appearance: consistent container widths, consistent border-radius, consistent input/button styling, embedded password toggles, properly structured profile and consent components, and clean institutional text links. The existing color palette (dark blue `#1e3a8a`, orange `#f28a1e`, grays, white) and all design tokens defined in `:root` MUST be preserved exactly. No color values are added, removed, or changed.

Impact: the current state looks unpolished and unprofessional, undermines trust on the very screens where users create and unlock a privacy-sensitive local vault, and causes concrete usability problems (toggles users cannot associate with their field, a consent checkbox detached from its text, a truncated name placeholder).

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN any auth state card (`.vault-auth-card`) renders alongside other screens THEN the system presents inconsistent container widths, internal padding, and vertical spacing between sections, producing arbitrary misalignments.

1.2 WHEN the unlock screen renders the local account block (`.local-account-chip` containing avatar initials, name, and email) THEN the system displays it cramped and misaligned because the element has no CSS rules and falls back to raw inline/default layout.

1.3 WHEN a password field renders (`.password-field` with its `[data-toggle-password]` button) THEN the system places the visibility toggle button outside/below the input as a misaligned floating control instead of embedding it inside the field, right-aligned.

1.4 WHEN input fields and the "APAGAR" confirmation input render across screens THEN the system shows inconsistent borders, corner radii, and internal padding rather than a single standardized input style.

1.5 WHEN the "Seu nome" field renders on the setup screen with placeholder "Como devemos chamar você?" inside the two-column `.form-grid.two` THEN the system truncates the placeholder so it is not fully visible, and the two columns do not stack vertically on smaller devices.

1.6 WHEN primary action buttons render (for example "Entrar" with the `↗` icon and "Criar e entrar" with its icon) THEN the system renders inconsistent button sizing, padding, and icon alignment across screens.

1.7 WHEN the secondary navigation links render ("Primeiro acesso? Crie sua conta" and "Já tem conta? Entrar", using `.auth-text-action`) THEN the system renders them as raw default buttons that look like tables or old HTML borders instead of clean institutional text links.

1.8 WHEN the setup consent control renders (`.auth-agreement` checkbox with the text "Entendo que não há recuperação de senha e vou guardar um backup.") THEN the system shows a loose, misaligned checkbox detached from its paragraph instead of an aligned checkbox-plus-text row.

1.9 WHEN the recovery screen renders the no-recovery notice ("Não há recuperação por e-mail...") and the "Último recurso" warning (`.recovery-warning`) THEN the system presents them as plain unstyled text with poor visual separation between the warnings and the available actions.

1.10 WHEN the recovery actions render ("Baixar cópia bruta antes de apagar" `.vault-raw-download`, "Voltar ao login", and the `.auth-recovery-actions` group) THEN the system renders misaligned default buttons instead of elegant, aligned hyperlinks/actions.

1.11 WHEN inputs, buttons, and cards render across the frontend THEN the system applies inconsistent corner radii and inconsistent font weights/sizes for titles versus supporting text.

### Expected Behavior (Correct)

2.1 WHEN any auth state card renders alongside other screens THEN the system SHALL use a single centered card container width standard (approximately 450px–500px for login/signup/recovery screens) with standardized internal padding and standardized vertical spacing between sections.

2.2 WHEN the unlock screen renders the local account block THEN the system SHALL present a flexible profile component: a circular gray avatar with initials ("TN") on the left, and to the right the name in bold with the email in a regular, smaller weight stacked beneath it, with adequate top and bottom spacing.

2.3 WHEN a password field renders THEN the system SHALL embed the visibility toggle icon inside the input field, right-aligned, and SHALL NOT render any toggle control floating below or outside the field.

2.4 WHEN input fields and the "APAGAR" confirmation input render THEN the system SHALL apply one standardized input style: slightly rounded corners (border-radius 6px or 8px), internal padding of approximately 12px, a soft gray border in the normal state, and a subtle focus state consistent with the existing focus token.

2.5 WHEN the "Seu nome" field renders with its placeholder "Como devemos chamar você?" THEN the system SHALL display the placeholder fully (not truncated), and on smaller devices the two-column grid SHALL stack its fields vertically.

2.6 WHEN primary action buttons render THEN the system SHALL apply one standardized orange button style: full width, centered typography, generous vertical padding (approximately 12px–14px), with action icons aligned natively inline inside the button.

2.7 WHEN the secondary navigation links render THEN the system SHALL render them as clean text links in the institutional dark-blue color, with no borders, and a subtle underline or opacity change on hover.

2.8 WHEN the setup consent control renders THEN the system SHALL integrate the checkbox with its paragraph using a flex row where the checkbox aligns to the top/left of the first text line with an adequate right margin (8px or 12px).

2.9 WHEN the recovery screen renders the no-recovery notice and the "Último recurso" warning THEN the system SHALL present the notice as a legible notice block (optionally with a very light gray or blue-gray background) with clear visual separation between warnings and actions.

2.10 WHEN the recovery actions render THEN the system SHALL present "Baixar cópia bruta antes de apagar" and "Voltar ao login" as elegant, aligned hyperlinks (with icons where appropriate), and the "APAGAR" confirmation input SHALL follow the standardized input style.

2.11 WHEN inputs, buttons, and cards render across the frontend THEN the system SHALL apply a standardized corner radius (recommended border-radius 8px) and consistent typography (bold for titles, regular for supporting text) with consistent sizes, while CONTINUING TO use only the existing palette tokens.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN any stylesheet or markup change is applied THEN the system SHALL CONTINUE TO use only the existing color palette tokens (dark blue `#1e3a8a`, orange `#f28a1e`, grays, white) defined in `:root`, adding/removing/changing no color values.

3.2 WHEN `public/style.css` is parsed by the token test suite THEN the system SHALL CONTINUE TO keep all resources 100% local (no `@import`, no remote `url(http...)`, no font CDNs, no remote `@font-face`) and SHALL CONTINUE TO keep every fixed `font-size` at or above the 13px floor.

3.3 WHEN the auth flow runs THEN the system SHALL CONTINUE TO support the unlock, setup, and recovery state transitions, the password visibility toggle behavior, the password strength indicator, and the "APAGAR" destroy-vault confirmation exactly as before.

3.4 WHEN screens that are already correctly aligned render THEN the system SHALL CONTINUE TO display them with their existing correct alignment and spacing (no regressions on currently-good layout).

3.5 WHEN assistive technology inspects the auth and app screens THEN the system SHALL CONTINUE TO expose the existing semantic structure, labels, `aria-live` regions, and focus-visible behavior at least as well as before.

3.6 WHEN the landing page and application shell render THEN the system SHALL CONTINUE TO expose all existing navigation, actions, and content without removing functionality while layout is standardized.

## Bug Condition and Properties

**Key Definitions:**
- **F**: the frontend (HTML/CSS) before this fix.
- **F'**: the frontend after standardization.

### Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type RenderedComponent  // a component rendered on any system page
  OUTPUT: boolean

  // True when the component is one whose current styling is missing,
  // inconsistent, or misaligned relative to the standardized design.
  RETURN X.isProfileBlock
      OR X.isPasswordField
      OR X.isInput
      OR X.isPrimaryButton
      OR X.isSecondaryTextLink
      OR X.isConsentCheckbox
      OR X.isRecoveryNoticeOrAction
      OR X.isAuthCardContainer
      OR X.hasInconsistentRadiusOrSpacingOrTypography
END FUNCTION
```

### Property — Fix Checking

```pascal
// Property: Fix Checking — standardized, aligned, palette-preserving rendering
FOR ALL X WHERE isBugCondition(X) DO
  render ← F'(X)
  ASSERT render.container.width ∈ [≈450px, ≈500px]  // for auth login/signup/recovery cards
     AND render.radius = standardizedRadius          // 6px–8px, 8px recommended
     AND render.inputPadding ≈ 12px
     AND render.passwordToggle.isEmbeddedRightAligned = true
     AND render.profileBlock.layout = "avatar-left + name(bold)/email(regular) stacked"
     AND render.consentCheckbox.isInlineWithText = true
     AND render.secondaryLink.looksLikeCleanTextLink = true
     AND render.primaryButton.isFullWidthCenteredWithInlineIcon = true
     AND render.placeholder.isFullyVisible = true
     AND render.usesOnlyExistingPaletteTokens = true
END FOR
```

### Property — Preservation Checking

```pascal
// Property: Preservation Checking — non-buggy inputs behave identically
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
  // palette tokens, local-only resources, >=13px font floor, auth state
  // transitions, toggle/strength/destroy behavior, and already-correct
  // layouts are all unchanged.
END FOR
```
