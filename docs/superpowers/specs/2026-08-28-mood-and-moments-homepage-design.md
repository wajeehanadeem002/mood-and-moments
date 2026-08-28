# Mood & Moments Homepage Design

## Goal

Replace the neutral Next.js starter screen with a polished, responsive Mood & Moments homepage that feels emotional, calm, personal, elegant, premium, and slightly cozy. Preserve the existing Next.js 16.3.3 App Router, TypeScript, Tailwind CSS 4, ESLint, and pnpm setup. Do not add backend, authentication, persistence, APIs, routes, or third-party UI and animation libraries. The only planned dependency addition is `lucide-react` for accessible, consistent interface and mood icons.

## Approved Visual Target

Implement the third generated direction, "The Quiet Ritual," preserved at `docs/superpowers/specs/mood-and-moments-homepage-option-3.png`.

The composition uses:

- A split hero: expressive editorial message on the left and an integrated mood-and-moment ritual on the right.
- Alternating full-width recent-moment rows instead of a generic card grid.
- A compact, highly scannable vertical timeline with date, mood, title, and summary columns.
- An atmospheric quote band followed by a restrained multi-column footer.
- Deep charcoal layers, muted burgundy, dusty lavender, sparing champagne highlights, warm off-white text, and muted gray supporting copy.

The implementation should match the visual hierarchy and rhythm of the target without reproducing mockup artifacts such as tiny illegible text, extra footer features, social icons, or links to nonexistent routes.

## Existing Project Findings

- Framework: Next.js 16.3.3 with React 19.2.8 and the App Router.
- Styling: Tailwind CSS 4 through `@tailwindcss/postcss`, plus one global stylesheet.
- Routes: only `/`, composed by `src/app/layout.tsx` and `src/app/page.tsx`.
- Components and design system: none.
- Functionality: only the create-next-app starter links.
- Reusable foundation: strict TypeScript, `@/*` source alias, next/font, Tailwind CSS, ESLint, pnpm scripts, and the existing App Router layout.
- Main limitations: starter metadata and copy, binary light/dark theme, no brand tokens, no responsive product components, no mood interaction, no realistic content, and no motion/accessibility treatment beyond browser defaults.

## Information Architecture

The single homepage contains these anchor targets in order:

1. `home`: navbar and split hero.
2. `moods`: interactive mood ritual within the hero.
3. `moments`: three alternating recent-moment rows.
4. `timeline`: five compact timeline entries.
5. Quote band.
6. Footer.

Navigation links scroll to real sections on the same page. No new routes are created. The primary CTA moves focus to the mood ritual; the secondary CTA scrolls to recent moments.

## Component Architecture

- `src/app/page.tsx`: server-rendered page composition only.
- `src/components/layout/site-header.tsx`: responsive brand navigation, desktop anchors, mobile menu state, and primary CTA.
- `src/components/home/hero.tsx`: hero copy and CTA grouping around the mood ritual.
- `src/components/home/mood-ritual.tsx`: client component for mood selection, prompt entry, character count, validation, and non-persistent preview confirmation.
- `src/components/home/recent-moments.tsx`: alternating image-and-copy rows rendered from typed data.
- `src/components/home/memory-timeline.tsx`: compact semantic timeline rendered from the same data source.
- `src/components/home/quote-section.tsx`: atmospheric full-width quote pause.
- `src/components/layout/site-footer.tsx`: brand summary and anchors to existing sections.
- `src/data/moments.ts`: mood definitions and realistic static moment data, including exported TypeScript types.
- `src/app/globals.css`: theme tokens, base styles, focus styles, background texture, and reduced-motion-safe animations.
- `src/app/layout.tsx`: Mood & Moments metadata and next/font pairing.

Each component owns one clear section. Static data stays separate from presentation, and only components that require interaction use `"use client"`.

## Content And Data

Mood choices are Happy, Calm, Loved, Sad, Angry, and Tired. Each choice pairs a Lucide icon with a visible text label; the icon is decorative and hidden from assistive technology.

Recent moments:

- August 28, 2026, 8:32 AM — Happy — "Slow Sunday light" — "Morning sun through the curtains, no plans, just a quiet beautiful start."
- August 27, 2026, 7:14 PM — Loved — "A call worth remembering" — "Caught up with an old friend. We laughed for an hour and it felt like no time had passed."
- August 26, 2026, 6:08 PM — Calm — "Rain against the window" — "The steady rhythm helped me slow down and be present with my thoughts."

The timeline reuses those moments and adds two text-only entries: "Needed a slower morning" on August 24 and "Walked by the river" on August 22. The quote is: "Some moments become memories before we even realize it."

The mood ritual is explicitly non-persistent. A valid submission produces an accessible in-page confirmation for the current view; it does not imply that data was saved to a database or account.

## Visual System

### Color

- Page background: `#121113`.
- Elevated background: `#171518`.
- Surface: `#1e1a1e`.
- Muted surface: `#241d21`.
- Burgundy: `#8f4354`.
- Rose hover: `#a85467`.
- Dusty lavender: `#8d7999`.
- Champagne: `#bea474`, used only for small dates, separators, and quote punctuation.
- Primary text: `#f0e7de`.
- Secondary text: `#aaa0a6`.
- Borders: warm translucent off-white between 8% and 14% opacity.

Contrast must remain readable without turning the design pure black or making the rose accent bright pink.

### Typography

Use Cormorant Garamond through `next/font/google` for major headings and Geist for navigation, controls, metadata, and body copy. Heading size uses responsive `clamp()` values, comfortable line height, and restrained tracking. Body copy stays between 15px and 18px with a maximum readable measure.

### Surfaces And Motion

Use section spacing and typography before adding borders. The mood ritual has one integrated translucent surface; recent moments use image/text rows divided by fine rules; the timeline is a single grouped list. Background glow, blur, grain, and shadow remain subtle.

CSS handles entrance, hover, focus, and mood-selection transitions. Every nonessential animation is disabled or reduced under `prefers-reduced-motion: reduce`.

## Image Assets

Generate original project-owned raster assets rather than using remote stock URLs, placeholder boxes, handcrafted SVGs, or CSS illustrations:

- A warm morning coffee-and-window photograph for "Slow Sunday light."
- A moody vintage telephone-and-notebook photograph for "A call worth remembering."
- A rain-on-window photograph with a warm interior foreground for "Rain against the window."
- A very subtle botanical dusk texture for the hero atmosphere.

Save optimized raster assets under `public/images/moments/` and `public/images/atmosphere/`. Render moment photography with `next/image`, explicit intrinsic dimensions, responsive `sizes`, and stable aspect-ratio wrappers to prevent layout shift. The quote band may reuse the rain image with a dark overlay.

## Responsive Behavior

- Desktop: two-column hero, six mood choices in one row, alternating split moment rows, and a multi-column timeline.
- Laptop/tablet: narrower hero columns, compact navigation, mood choices wrap into two rows, and timeline copy reduces to essential metadata.
- Mobile: navigation becomes a keyboard-accessible text-labeled menu; hero stacks copy before ritual; CTAs become full width; moods use a three-column grid with at least 44px targets; moment image and copy stack; timeline becomes date-first blocks with a continuous vertical rule.
- Small mobile: typography and section padding reduce through `clamp()`; no horizontal scrolling; buttons remain full-width where needed; long text wraps naturally.

## Accessibility And Interaction

- Semantic `header`, `nav`, `main`, `section`, `article`, `ol`, `blockquote`, and `footer` elements.
- One page-level `h1`, sequential section headings, descriptive image alt text, and decorative imagery with empty alt text where appropriate.
- Buttons use visible labels, correct `type`, pressed state where applicable, and at least 44px touch targets.
- Mood selection supports keyboard navigation through native buttons and exposes `aria-pressed`.
- Mobile navigation exposes its expanded state and renders native anchor links inside a controlled menu.
- Strong `:focus-visible` outlines use the rose accent plus an offset from dark surfaces.
- The moment textarea has a visible label, maximum length of 120, character count, inline validation, and `aria-live` feedback.
- Color is never the only mood indicator; every state includes a text label.

## Error Handling

The homepage has no network or data-loading states. The only error state is an empty mood-ritual submission, which keeps focus near the field and announces a concise validation message. The component never throws for unknown mood values because all choices come from a typed local array.

## Verification

- Run `pnpm.cmd lint`.
- Run `pnpm.cmd typecheck`.
- Run `pnpm.cmd build`.
- Smoke-test `/` through `pnpm.cmd dev` and require HTTP 200.
- Verify CTA anchors, mobile menu, six mood states, input validation, character count, and preview confirmation.
- Review desktop, tablet, mobile, and small-mobile layouts for overflow, spacing, typography, image crops, contrast, focus states, and section rhythm.
- Verify the implementation against the selected mockup at matching desktop dimensions, then inspect responsive states independently rather than shrinking the desktop layout.
- Confirm reduced-motion behavior and confirm no existing configuration, dependencies, APIs, auth, or persistence were added or removed.

No commits or pushes are part of this UI task.
