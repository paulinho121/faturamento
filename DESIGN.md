---
name: Precision Billing
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#434655'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#006242'
  on-tertiary: '#ffffff'
  tertiary-container: '#007d55'
  on-tertiary-container: '#bdffdb'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  tabular-nums:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 48px
---

## Brand & Style

This design system is built on a foundation of **Modern Minimalism**, emphasizing clarity, speed, and high-trust interactions for financial environments. Drawing inspiration from industry leaders like Linear and Stripe, the aesthetic prioritizes functional whitespace and a strict adherence to a systematic grid. 

The personality is professional and reliable, yet feels technologically advanced. It avoids unnecessary decoration, using subtle depth and purposeful color application to guide the user's focus toward critical billing data and real-time transaction states. The emotional response should be one of "effortless control"—where complex financial information feels organized and manageable.

## Colors

The color palette is engineered for high legibility and semantic clarity. 
- **Primary (Blue):** Reserved for primary actions, progress indicators, and active states.
- **Surface/Dark (Slate):** Used for primary text and high-contrast UI elements like headers or sidebar navigation to ground the design.
- **Success/Billing (Green):** Specifically for positive cash flow, paid invoices, and growth indicators.
- **Danger (Red):** Used sparingly for cancellations, overdue payments, and destructive actions.
- **Backgrounds:** A tiered system using pure white for the base layer and "Very Light Gray" (F8FAFC) for secondary surface containers to create subtle grouping without heavy borders.

## Typography

Inter is utilized across all levels to maintain a systematic, utilitarian feel. 
- **Display & Headlines:** Use tighter letter spacing and heavier weights to create a strong visual hierarchy.
- **Tabular Numbers:** For billing and real-time data, always enable `tnum` (tabular figures) to ensure columns of numbers align perfectly for easy scanning.
- **Labels:** Use Medium weights (500) for small captions to ensure legibility on mobile screens.
- **Hierarchy:** Primary emphasis is placed on the "Amount" and "Status" fields, using `title-md` or `headline-lg`.

## Layout & Spacing

The design system employs a **Fluid Grid** model based on an 8pt spacing system (with 4pt increments for micro-adjustments). 
- **Mobile:** 4-column grid with 16px side margins and 16px gutters.
- **Desktop:** 12-column grid with a maximum content width of 1280px.
- **Vertical Spacing:** Generous padding (24px - 32px) is used between logical sections to maintain the "high whitespace" aesthetic and prevent the UI from feeling cramped during heavy data density.

## Elevation & Depth

Hierarchy is established through **Tonal Layers** and **Ambient Shadows**. 
- **Level 0 (Background):** #FFFFFF.
- **Level 1 (Cards/Surface):** #F8FAFC with a 1px inner border of #E2E8F0.
- **Level 2 (Raised):** Used for active cards and dropdowns. This utilizes a very soft, diffused shadow: `0px 4px 12px rgba(15, 23, 42, 0.05)`.
- **Level 3 (Overlay):** Used for modals and floating action buttons. A deeper shadow to suggest height: `0px 12px 32px rgba(15, 23, 42, 0.1)`.
Avoid heavy dark shadows; depth should feel like light catching the edge of a physical card.

## Shapes

The shape language is refined and approachable.
- **Standard Radius:** 8px for small components (inputs, small buttons).
- **Large Radius:** 16px for cards, containers, and modals.
- **Pill:** Reserved for status badges and indicators (Success/Danger tags) to differentiate them from interactive buttons.
- **Buttons:** Fully rounded (pill) or 8px depending on the specific platform density requirements, though pill-shaped is preferred for primary calls to action.

## Components

- **Cards:** White or F8FAFC background, 16px border radius, 1px subtle border (#E2E8F0). No heavy shadows unless hovered/active.
- **Buttons:** 
  - *Primary:* Blue background, white text, 8px or pill radius. 
  - *Secondary:* Transparent background, Blue text, 1px Blue border.
- **Input Fields:** 8px radius, #F8FAFC background, 1px border that turns Blue on focus. Labels sit clearly above the field in `label-md`.
- **Badges:** Small pill-shaped indicators. Use low-opacity background tints (e.g., Green at 10% opacity) with high-contrast text for high readability without visual noise.
- **Charts:** Use thin stroke weights for line charts and "donut" style pie charts with a center-aligned total. Primary Blue and Success Green are the lead data colors.
- **Skeleton Loaders:** Use a subtle pulse animation on #F1F5F9 shapes to maintain the feeling of "real-time" speed during data fetches.
- **Bottom Navigation:** A clean white blur (backdrop-filter) container with Material Design icons. Active states use the Primary Blue; inactive states use a muted Slate (#64748B).
- **Lists:** Clean rows with 16px vertical padding, separated by a 1px #F1F5F9 divider.