# EduFlow LMS — Design System

## Status and direction

This is the visual contract for the EduFlow frontend. Phases 5A–5B implement the catalog, authentication, student learning, instructor authoring/review, and admin moderation screens.

Build a clear, professional SaaS interface for learning and course management. Prioritize readable content, predictable navigation, compact controls, and visible progress. Use restrained decoration; avoid excessive gradients, glow, oversized cards, and charts populated with invented data.

## Color tokens

| Token | Light | Dark |
| --- | --- | --- |
| Primary | `#09318D` | `#0297DE` |
| Background | `#F6F8FC` | `#02070A` |
| Surface | `#FFFFFF` | `#101A24` |
| Accent | `#FD91CC` | `#FC734D` |
| Text | `#172033` | `#F8FAFC` |
| Muted text | `#64748B` | `#94A3B8` |

Use primary for main actions, active navigation, links, and focus indicators. Use accent consistently for course-card highlights, level badges, learning progress, selected lesson emphasis, and selected secondary learning actions. The catalog heading and empty-state illustration must retain visible accent color when no courses exist. Accent is not an error, warning, or completion-status color; success and error retain their semantic treatments. Never rely on color alone to communicate state.

Define colors once in theme variables and expose semantic Tailwind tokens through `@theme inline` in `frontend/src/styles.css`. Components use the shared accent, foreground, subtle-surface, and progress-track tokens rather than per-screen color literals. Raw accent fills require dark foregrounds in both themes. Selected lessons retain a contrasting boundary and font-weight change; progress retains explicit counts/percentage and a contrasting track. Do not add gradients, glow, or extra decorative components to introduce accent color.

### Verified foreground choices

Contrast ratios below use the WCAG relative-luminance calculation, rounded to two decimals. Normal text needs at least 4.5:1; large text and meaningful non-text boundaries need at least 3:1. Validate final component states, not only base tokens.

| Foreground / background | Ratio | Use |
| --- | --- | --- |
| `#FFFFFF` / light primary `#09318D` | 11.44:1 | Light-theme primary button text |
| Light text `#172033` / light background `#F6F8FC` | 15.30:1 | Body text |
| Light text `#172033` / light accent `#FD91CC` | 7.82:1 | Accent badge text |
| Light muted `#64748B` / white surface | 4.76:1 | Secondary text on cards |
| Light muted `#64748B` / light background | 4.48:1 | Fails normal text; use main text or a verified darker token |
| Dark background `#02070A` / dark primary `#0297DE` | 6.25:1 | Dark-theme primary button text |
| Dark text `#F8FAFC` / dark primary `#0297DE` | 3.10:1 | Fails normal button text; use dark foreground |
| Dark background `#02070A` / dark accent `#FC734D` | 7.42:1 | Accent badge text |
| Dark muted `#94A3B8` / dark surface `#101A24` | 6.85:1 | Secondary text on cards |

Dark primary blue also needs attention when used for normal-size link text on a dark surface. Verify the exact pairing, or use a lighter verified link token with an underline. Decorative accent fills do not replace accessible focus or status indicators.

## Typography and spacing

Use Inter, with a system sans-serif fallback. Default body copy is 16px with approximately 1.5 line height; secondary labels may use 14px with sufficient contrast. Use a restrained hierarchy: 32px page title, 24px section title, 20px subsection title, adjusted for small screens. Use weights 400, 500, 600, and 700 consistently. Avoid all-caps paragraphs and dense text blocks.

Use an 8px spacing grid: 8, 16, 24, 32, 40, 48, and 64px. Allow 4px for fine icon or label alignment. Buttons and inputs use an 8px radius; cards use 12px. Use subtle borders and restrained shadows to distinguish surfaces. Keep page gutters at least 16px on small screens, increasing to 24–32px with available space. Cap content width where reading or forms benefit from shorter lines.

## Component conventions

| Component | Convention |
| --- | --- |
| Buttons | Primary, secondary, and quiet variants; consistent 40–44px height, with 44px targets for touch; visible hover, focus, disabled, loading, and destructive states |
| Inputs | Persistent labels, concise helper/error text, clear required state, 40–44px control height, visible focus; placeholders never replace labels |
| Cards | Group related content with 16–24px padding; size to content; avoid making every information fragment a separate card |
| Navigation | Predictable active state and page title; role-specific destinations appear only when supported by the API |
| Tables and lists | Stable column alignment, readable density, sorting/pagination where supported; adapt to small screens without hiding essential actions |
| Course content | Clear course/module/lesson hierarchy, ordered lessons, readable content, explicit completion controls |
| Progress | Pair percentage or counts with a label; use real API values and explain empty or unavailable states |
| Feedback | Distinct loading, empty, error, and success states; recovery actions where useful; toasts must not be the only place critical errors appear |
| Icons | Lucide icons with consistent sizing and stroke; label ambiguous actions; mark decorative icons as hidden from assistive technology |
| Dialogs | Concise title and explicit action labels; logical focus, Escape dismissal when appropriate, and focus return on close |

## Responsive behavior and accessibility

Start with narrow screens and adapt layouts to content. Use a single main column for small screens; introduce side navigation and multi-column layouts only when space permits. Forms should stay readable rather than stretching edge to edge on wide displays. Tables may scroll horizontally or switch to an accessible list when that better preserves meaning. Do not create a mobile experience that requires precise taps or hover.

Use semantic landmarks and a logical heading order. Support keyboard navigation, visible focus, accessible names, form error associations, and screen-reader announcements for meaningful async updates. Support 200% zoom, text reflow at narrow widths, and reduced-motion preferences. Focus indicators must remain visible against adjacent colors. Every theme, state, and validation message needs contrast verification. Test with keyboard interaction and browser accessibility tools before calling a screen complete.

## Consistency checklist

- Reuse shared tokens and components; avoid unexplained per-screen values.
- Keep spacing, control heights, corner radii, icon sizes, and labels consistent.
- Distinguish actual data, empty states, loading states, and unavailable data honestly.
- Check narrow and wide layouts, both themes, keyboard behavior, and contrast.
- Keep implementation details out of the user flow unless they help a user make a decision.
