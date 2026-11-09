# EduFlow LMS — Design System

## Status and direction

This is the visual contract for the EduFlow frontend. Phases 5A–5B implement the catalog, authentication, student learning, instructor authoring/review, and admin moderation screens.

Build a clear, professional SaaS interface for learning and course management. Prioritize readable content, predictable navigation, compact controls, and visible progress. Use restrained decoration; avoid excessive gradients, glow, oversized cards, and charts populated with invented data.

## Color tokens

| Token | Light | Dark |
| --- | --- | --- |
| Supporting brand | `#09318D` | `#0297DE` |
| Background | `#F6F8FC` | `#02070A` |
| Surface | `#FFFFFF` | `#101A24` |
| Accent / primary action | `#FD91CC` | `#FC734D` |
| Text | `#172033` | `#F8FAFC` |
| Muted text | `#64748B` | `#94A3B8` |

Use the accent for primary CTAs, hero emphasis, meaningful decorative accents, and selected highlights: pink in Light Mode maps to orange in Dark Mode. Supporting brand blue is for lighting, brand identity, secondary actions, links, focus, and informational elements; electric blue must not replace orange on a primary CTA. Keep success, error, warning, and existing progress semantics distinct. The catalog heading and empty-state illustration retain accent color when no courses exist. Never rely on color alone to communicate state.

Define colors once in theme variables and expose semantic Tailwind tokens through `@theme inline` in `frontend/src/styles.css`. `--primary` remains the supporting blue brand token; `--primary-action` aliases `--accent`, with `--primary-action-foreground` using `#02070A`. `--surface-elevated` aliases the theme surface. These roles are shared by CSS and Tailwind; scoped catalog/navbar tokens must consume these aliases rather than redefine the action palette. Components use the shared accent, foreground, subtle-surface, and progress-track tokens rather than per-screen color literals. Raw accent fills require dark foregrounds in both themes. Selected lessons retain a contrasting boundary and font-weight change; progress retains explicit counts/percentage and a contrasting track. Use layered lighting only as part of the approved discovery atmosphere; avoid decorative glow in learning and editing workspaces.

### Verified foreground choices

Contrast ratios below use the WCAG relative-luminance calculation, rounded to two decimals. Normal text needs at least 4.5:1; large text and meaningful non-text boundaries need at least 3:1. Validate final component states, not only base tokens.

| Foreground / background | Ratio | Use |
| --- | --- | --- |
| `#FFFFFF` / supporting blue `#09318D` | 11.44:1 | Blue secondary button text |
| Light text `#172033` / light background `#F6F8FC` | 15.30:1 | Body text |
| Action foreground `#02070A` / pink `#FD91CC` | 9.73:1 | Light primary CTA text |
| Light muted `#64748B` / white surface | 4.76:1 | Secondary text on cards |
| Light muted `#64748B` / light background | 4.48:1 | Fails normal text; use main text or a verified darker token |
| Dark background `#02070A` / supporting blue `#0297DE` | 6.25:1 | Blue secondary button text |
| Dark text `#F8FAFC` / supporting blue `#0297DE` | 3.10:1 | Fails normal text; use dark foreground |
| Action foreground `#02070A` / orange `#FC734D` | 7.42:1 | Dark primary CTA text |
| Dark muted `#94A3B8` / dark surface `#101A24` | 6.85:1 | Secondary text on cards |

Supporting blue also needs attention when used for normal-size link text on a dark surface. Verify the exact pairing, or use a lighter verified link token with an underline. Decorative accent fills do not replace accessible focus or status indicators.

## Approved catalog and product visual language

The `/courses` catalog has a separate art-directed composition informed by `design-references/light-reference.jpg` and `design-references/dark-reference.jpg`: a centered editorial hero, floating translucent navigation capsule, layered blue/cyan-to-white lighting and irregular edge pixels in Light Mode, and vertical blue rays with orange underlighting over midnight tones in Dark Mode. Ignore social-media overlays in the references; never invent course statistics, charts, or media content to reproduce their foreground panels.

Light course cards use white surfaces and dark typography. Dark course cards and covers use `#101A24`, primary text `#F8FAFC`, secondary text `#94A3B8`, and subtle blue borders. Primary actions use pink/orange with dark foregrounds in the respective themes; electric blue remains supporting illumination and secondary identity. This replaces the earlier white-card treatment in Dark Mode. Scoped `--catalog-*` tokens and `.catalog-shell` rules preserve the approved catalog implementation. The remaining product uses a separate `.product-shell` extension in `product.css` and composition-specific `pages.css`: immersive discovery and authentication, a branded course introduction, and quieter learning/authoring workspaces with elevated light or dark surfaces. Card entrances respect reduced motion and never gate access to content. The full-page extension requires user visual approval before production QA.

The central layered hero card uses an elevated white surface in Light Mode and `#101A24` in Dark Mode, with a pink/orange decorative arrow and subtle accent border/shadow. Preserve its dimensions, rotation, layering, responsive rules, and animation. Decorative arrows are not interactive controls; interactive accent fills use a contrasting dark glyph.

Shared native select controls use `SelectControl`: one decorative Lucide `ChevronDown`, native browser arrows hidden, 44px height, 16px left padding and right icon inset, 50px reserved right padding, and a visible 2px focus ring with 2px offset. Keep keyboard selection native. Level and status controls share this geometry; category remains a text input matching the actual API. Control icons never replace accessible labels. Verify text clearance and unclipped focus at 320, 375, 768, 1024, and 1440px in both themes.

## Shared product navigation and theme control

Every page uses the same shared `Navbar` and navigation stylesheet, extracted from the approved catalog capsule. At desktop widths a three-zone grid uses equal outer tracks so the navigation center aligns with the entire capsule; brand and actions align left and right. Collapse links into the existing mobile menu before the zones overlap. Preserve the catalog’s 1216px maximum width, 16×24px desktop padding, translucent blue/midnight backgrounds, border, 20px blur, compact-scroll state, and button geometry. A constant navy/midnight underlay beneath the translucent fill keeps white navigation text readable and the capsule color consistent over different page backgrounds. Sign in uses white with Deep Blue text; Get Started and Workspace use the shared pink/orange primary-action role in Light/Dark Mode. Its fixed position reserves space above content; account and theme menus must stay inside the viewport at 320px. Public destinations and role-aware links remain consistent across routes, including catalog section anchors that preserve active search/filter parameters. The existing `/` route is a landing page with three real API courses and in-page introduction, learning steps, and instructor sections; `/learning` continues to combine the student dashboard and enrolled courses.

Theme selection uses a 44px icon button (Sun, Moon, or Monitor) and a viewport-clamped popover with Light, Dark, and System radio-menu options. Support Arrow keys, Home/End, Enter/Space, Escape, outside click, selected-state announcements, and focus return. Store only the existing theme preference; System follows operating-system changes. Native filters continue to use `SelectControl`.

Public Home and Catalog navigation highlights the section currently passing beneath the capsule, using the existing active-link fill and `aria-current`. Desktop and mobile share the same selection. Introductory/featured content maps to Home on `/` and Explore Courses on `/courses`; About remains selected at the page footer. Passive scrolling never changes the URL or history. Existing destinations, Catalog filters, role-aware navigation, and cinematic motion remain unchanged. Each navigation container uses one decorative active indicator, transitioning its position and dimensions over 300ms with ease-in-out motion. Resize measurements follow the actual links, including the vertical mobile menu. Reduced motion disables the transition; unmeasured navigation retains its static active-link fill. No new scrolling behavior is introduced.

Discovery uses expressive large headings and a restrained serif italic emphasis alongside Inter. Workspace page titles scale from 32px to 48px, with readable 16px lesson text and a capped reading width. Forms retain persistent labels, preserve inputs, and use password visibility toggles without changing submission behavior. Course/editor cards have 12px corners; controls have 8px corners and at least 44px interaction targets. Dashboard summaries and progress always use server records, with no decorative statistics.

The shared `Footer` retains EduFlow branding, the existing route/role-aware navigation and its visibility rules; authentication pages keep their compact footer-free layout. A compact Contact & Support section provides two `mailto:support@eduflow.example` links with a visible, accessible description stating that the demo address is not a functioning inbox. Footer-scoped styles reuse theme colors, preserve existing padding and borders, wrap on small screens, and maintain 44px links with visible focus indicators. Render it once through the shared shell rather than duplicating it in pages.

## Shared atmosphere and motion

`atmosphere.css` defines three reusable, theme-aware lighting recipes: discovery (Home and Explore), learning introductions (My Learning, authentication, and course introductions), and quieter workspace illumination. Reuse these tokens rather than copying page gradients. `Atmosphere` supplies static edge pixels and dark vertical light textures; decorations are hidden from assistive technology and never receive pointer events. Surfaces remain white in Light Mode and `#101A24` in Dark Mode. My Learning combines an atmospheric personal hero, server-backed statistics, progress cards, and an original decorative empty-state illustration; no statistics or courses are synthesized in production.

`useScrollReveal` observes explicit `data-reveal` targets within the page main element. A single reveal observer is separate from the catalog pagination observer. Entrance keyframes use opacity 0→1 and translateY 24px→0 over 600ms with `cubic-bezier(0.22, 1, 0.36, 1)`; `data-reveal-index` adds 80ms per card capped at 400ms. Headings, static illustrations, and cards can reveal; navigation, editable forms, active inputs, and lesson reading content do not. Avoid nested animated targets.

Unenhanced content is visible. With observer support, eligible targets are prepared in a layout effect before paint and wait at opacity 0 until intersection starts their once-only entrance, avoiding a visible-then-hidden flash. Unavailable observer APIs, reduced motion, and teardown leave content visible; unseen targets remain eligible through React Strict Mode effect replay. Keyboard focus immediately finishes the relevant entrance. Reduced motion disables movement, including when the preference changes while the page is open. Duration-aware fallback timers must handle both `ms` and `s`, including units shortened by production CSS minification. Async API cards use the same registration path, without changing catalog requests, deduplication, or the manual Load More fallback.

The public-page directional prototype retains this lifecycle and easing, using 200px directional offsets over 1050ms through shared CSS variables. Heading groups travel 240px with a directional clip reveal and a 48px bleed area; Hero artwork and elevated surfaces remain unmasked to protect their shadows. Clipping is removed when the reveal finishes or is settled for focus, reduced motion, or theme motion. Home and Catalog Hero faces enter 280px from the left while their orbital carriers and existing pixel decorations remain unchanged. Featured/catalog introductions and instructor content enter from above; learning-step content enters from the right; About content enters from below. Unqualified targets, including course cards, retain their 24px upward entrance, 600ms duration, and existing stagger. The cleanup fallback follows each target's configured duration. Navigation section containers and IDs remain stationary, with reveals applied to their content; page-shell horizontal clipping contains translated paint without adding a scroll container.

## Hero orbital theme transitions

Resolve Light/Dark/System before React renders. Initial entry, refresh, and ordinary client-side navigation must not play a theme animation. On an effective theme change, the visible Home or Explore Courses Hero composition moves as one object: heading, subtitle, CTAs, and central artwork. Navigation and unrelated page content remain stationary; the existing gradients, light textures, and pixels transform progressively with the moving Hero.

Use one normalized 0→1 progress timeline over 1600ms for Hero translation, visibility, atmospheric reveal, decorative lighting, and palette handoff. Animate the complete existing Hero with `translate3d(x, y, 0)` only: no scale, rotation, perspective, or negative-Z foreshortening. Compute curved paths from `window.innerWidth`, `window.innerHeight`, and the measured Hero rectangle, with a safety margin. Sunrise starts its incoming path wholly below and left of the viewport (`right < 0`, `top > innerHeight`) and rises into its exact resting position. Sunset exits wholly below and right (`left > innerWidth`, `top > innerHeight`) before the centered destination Hero enters gently.

Temporary source and destination atmospheric surfaces reuse the approved gradient recipes and static decorations. Reveal the destination spatially along the solar direction, with no unrelated circle effect or generic solid-color fade. The same progress value drives every scene part; do not introduce independent animation clocks. Conceal the underlying palette update behind these layers while the Hero is hidden. Finish the background reveal with the Hero's arrival, then remove layers and restore the exact original layout. Do not clone the application or leave a permanent overlay.

The shared controller retains preference persistence, OS theme changes under System, cancellation guards, and reduced-motion support. Routes without an appropriate visible Hero and browsers without the animation capability switch immediately. Rapid changes and route departures cancel stale motion and settle the latest theme. No scroll reveal is restarted; active reveals settle when orbital motion begins, while unseen sections retain their once-only behavior. Temporary transforms and timers are cleaned up without moving focus or scroll position.

## Typography and spacing

The catalog display headline uses `Georgia, "Times New Roman", serif` at weight 400, with italic emphasis on “what’s next.” in both themes. Typography is theme-independent: desktop size is `clamp(60px, 6vw, 88px)` with 1.07 line height and -3px tracking; at 540px and below use `clamp(44px, 11.8vw, 60px)`, 1.08 line height, and -1.8px tracking. Keep its explicit line break and centered alignment; theme selectors may change colors, not these metrics.

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

Use semantic landmarks and a logical heading order. Support keyboard navigation, visible focus, accessible names, form error associations, and screen-reader announcements for meaningful async updates. Support 200% zoom, text reflow at narrow widths, and reduced-motion preferences. Focus indicators must remain visible against adjacent colors. Every theme, state, and validation message needs contrast verification. Disabled controls retain clear disabled styling and native semantics; inactive controls are exempt from WCAG contrast requirements. Focus rings must contrast with their adjacent page/surface and retain the approved offset, particularly around orange controls. Test with keyboard interaction and browser accessibility tools before calling a screen complete.

## Consistency checklist

- Reuse shared tokens and components; avoid unexplained per-screen values.
- Keep spacing, control heights, corner radii, icon sizes, and labels consistent.
- Distinguish actual data, empty states, loading states, and unavailable data honestly.
- Check narrow and wide layouts, both themes, keyboard behavior, and contrast.
- Keep implementation details out of the user flow unless they help a user make a decision.
