# Mood & Moments Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Option 3 homepage as a polished, responsive, accessible, and interactive single-page Mood & Moments experience.

**Architecture:** Keep `src/app/page.tsx` as a small Server Component that composes focused section components. Store typed static content separately, isolate the interactive mood ritual and mobile navigation behind narrow Client Component boundaries, and keep the visual system in Tailwind utilities plus shared CSS tokens in `globals.css`.

**Tech Stack:** Next.js 16.3.3 App Router, React 19.2.8, TypeScript 5.9, Tailwind CSS 4.3, `next/font`, `next/image`, Lucide React icons, Vitest, Testing Library, jsdom, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-28-mood-and-moments-homepage-design.md`

## Global Constraints

- Work in the existing `D:\mood-and-moments` Next.js project; do not re-scaffold or create another application.
- Preserve the existing App Router, TypeScript, Tailwind CSS 4, ESLint, pnpm, `src/app`, and `@/*` import setup.
- Keep `/` as the only route and use real same-page anchors for navigation.
- Add no backend, API, authentication, database, persistence, or analytics behavior.
- Add only `lucide-react` at runtime; test-only packages may be added as dev dependencies.
- Generate project-owned raster photography and atmosphere assets; do not use remote stock URLs, placeholders, emoji, CSS drawings, handcrafted SVGs, or inline SVGs.
- Use Server Components by default and Client Components only for stateful interactions.
- Respect semantic HTML, keyboard navigation, visible focus, 44px touch targets, sufficient contrast, stable image dimensions, and `prefers-reduced-motion`.
- Do not commit or push any changes.
- Execute in the current working tree as explicitly authorized by the user; preserve unrelated files and changes.

## File Map

- Modify `package.json`: add the `test` script, Lucide runtime dependency, and test-only dev dependencies.
- Modify `pnpm-lock.yaml`: record dependency resolution through pnpm.
- Create `vitest.config.mts`: jsdom test environment and `@/*` alias.
- Create `src/test/setup.ts`: Testing Library cleanup after each test.
- Create `src/data/moments.ts`: typed mood definitions, recent moments, and timeline entries.
- Create `src/lib/mood-ritual.ts`: pure validation and confirmation behavior.
- Create `src/lib/mood-ritual.test.ts`: validation and confirmation regression tests.
- Create `src/components/ui/brand-mark.tsx`: reusable icon-library brand mark.
- Create `src/components/ui/mood-icon.tsx`: typed mood-to-icon mapping.
- Create `src/components/layout/site-header.tsx`: responsive brand navigation and working mobile menu.
- Create `src/components/layout/site-header.test.tsx`: navigation behavior tests.
- Create `src/components/layout/site-footer.tsx`: branded footer with only real anchors.
- Create `src/components/home/hero.tsx`: editorial hero copy and CTA composition.
- Create `src/components/home/mood-ritual.tsx`: interactive mood selector and non-persistent form.
- Create `src/components/home/mood-ritual.test.tsx`: selection, validation, focus, and success tests.
- Create `src/components/home/recent-moments.tsx`: alternating responsive moment rows.
- Create `src/components/home/memory-timeline.tsx`: semantic responsive timeline.
- Create `src/components/home/quote-section.tsx`: atmospheric quote band.
- Modify `src/app/page.tsx`: compose the full homepage.
- Create `src/app/page.test.tsx`: page-level semantic and content integration test.
- Modify `src/app/layout.tsx`: metadata, Cormorant Garamond, Geist, and root classes.
- Modify `src/app/globals.css`: tokens, base styles, background treatment, transitions, and responsive/reduced-motion behavior.
- Create `public/images/moments/slow-sunday-light.png`: warm coffee-by-window photograph.
- Create `public/images/moments/call-worth-remembering.png`: vintage telephone-and-notebook photograph.
- Create `public/images/moments/rain-against-window.png`: rain-on-window photograph.
- Create `public/images/atmosphere/botanical-dusk.png`: subtle botanical dusk texture for hero and quote atmosphere.
- Create `design-qa.md`: evidence-based comparison report against the approved target.

---

### Task 1: Install the Runtime Icon and Test Harness

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `vitest.config.mts`
- Create: `src/test/setup.ts`

**Interfaces:**
- Consumes: the existing pnpm package and TypeScript alias configuration.
- Produces: `pnpm.cmd test`, a jsdom test runtime, Testing Library cleanup, and Lucide React imports for UI components.

- [ ] **Step 1: Install the icon library and test-only dependencies**

Run:

```powershell
pnpm.cmd add lucide-react
pnpm.cmd add -D vitest jsdom @testing-library/react
```

Expected: `package.json` and `pnpm-lock.yaml` update without peer-dependency errors.

- [ ] **Step 2: Add the test script**

Add this entry to `package.json` scripts:

```json
"test": "vitest run"
```

- [ ] **Step 3: Configure Vitest**

Create `vitest.config.mts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

Create `src/test/setup.ts`:

```ts
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

- [ ] **Step 4: Verify the empty harness**

Run: `pnpm.cmd test --passWithNoTests`

Expected: PASS with no test files found and no configuration errors.

### Task 2: Define Typed Content and Mood-Ritual Behavior

**Files:**
- Create: `src/data/moments.ts`
- Create: `src/lib/mood-ritual.ts`
- Create: `src/lib/mood-ritual.test.ts`

**Interfaces:**
- Consumes: no earlier application code.
- Produces: `MoodId`, `MoodDefinition`, `Moment`, `moods`, `recentMoments`, `timelineMoments`, `validateMomentText(value: string): string | null`, and `createMomentConfirmation(moodLabel: string): string`.

- [ ] **Step 1: Write the failing behavior test**

Create `src/lib/mood-ritual.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createMomentConfirmation,
  validateMomentText,
} from "./mood-ritual";

describe("mood ritual behavior", () => {
  it("rejects a moment containing only whitespace", () => {
    expect(validateMomentText("   ")).toBe(
      "Write a few words about the moment you want to remember.",
    );
  });

  it("accepts a meaningful moment", () => {
    expect(validateMomentText("Coffee by the window")).toBeNull();
  });

  it("confirms the selected mood without claiming persistence", () => {
    expect(createMomentConfirmation("Calm")).toBe(
      "Your Calm moment is ready in this preview.",
    );
  });
});
```

- [ ] **Step 2: Run the test and verify the RED state**

Run: `pnpm.cmd test -- src/lib/mood-ritual.test.ts`

Expected: FAIL because `src/lib/mood-ritual.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure behavior**

Create `src/lib/mood-ritual.ts` with the two exact exports and literal validation/confirmation strings used by the test.

- [ ] **Step 4: Add typed static data**

Create `src/data/moments.ts` with:

```ts
export type MoodId = "happy" | "calm" | "loved" | "sad" | "angry" | "tired";

export type MoodDefinition = {
  id: MoodId;
  label: string;
  description: string;
  accent: "rose" | "lavender" | "champagne";
};

export type Moment = {
  id: string;
  date: string;
  dateTime: string;
  time: string;
  mood: MoodId;
  title: string;
  excerpt: string;
  image?: { src: string; alt: string };
};
```

Populate the six approved moods, three approved recent moments, and five approved timeline entries from the spec. Image paths must match the file map.

- [ ] **Step 5: Run the behavior test and type-check**

Run:

```powershell
pnpm.cmd test -- src/lib/mood-ritual.test.ts
pnpm.cmd typecheck
```

Expected: both commands PASS.

### Task 3: Generate and Place the Four Visual Assets

**Files:**
- Create: `public/images/moments/slow-sunday-light.png`
- Create: `public/images/moments/call-worth-remembering.png`
- Create: `public/images/moments/rain-against-window.png`
- Create: `public/images/atmosphere/botanical-dusk.png`

**Interfaces:**
- Consumes: the approved Option 3 target and the exact image slots in the spec.
- Produces: four project-owned landscape raster assets with coordinated low-key editorial photography.

- [ ] **Step 1: Generate the coffee image**

Use ImageGen with a 3:2 landscape composition: a ceramic coffee cup and small dried botanical arrangement beside a softly sunlit window, warm low morning light, quiet domestic realism, charcoal and amber grade, shallow depth of field, no people, no lettering, no logos.

- [ ] **Step 2: Generate the telephone image**

Use ImageGen with a 3:2 landscape composition: a black vintage rotary telephone beside an open cream notebook and pen on a wooden table, warm pool of evening light, deep charcoal shadows, cinematic editorial photography, no people, no lettering, no logos.

- [ ] **Step 3: Generate the rain image**

Use ImageGen with a 3:2 landscape composition: rain beads and trails on a dark window, a warm candle and mug softly out of focus in the interior foreground, muted burgundy and amber reflections, contemplative cinematic photography, no people, no lettering, no logos.

- [ ] **Step 4: Generate the botanical dusk atmosphere**

Use ImageGen with a wide landscape composition: deep burgundy dusk sky with subtle cloud texture and delicate out-of-focus botanical silhouettes entering from the edges, generous dark negative space, restrained champagne warmth, atmospheric photographic texture, no text, no logos.

- [ ] **Step 5: Inspect and place every asset**

Open each generated image, confirm the focal point survives the planned `object-cover` crop, then copy it to the exact paths above without overwriting unrelated assets.

### Task 4: Build and Test the Interactive Navigation

**Files:**
- Create: `src/components/ui/brand-mark.tsx`
- Create: `src/components/layout/site-header.test.tsx`
- Create: `src/components/layout/site-header.tsx`

**Interfaces:**
- Consumes: Lucide React and the real anchors `#home`, `#moods`, `#moments`, and `#timeline`.
- Produces: `BrandMark({ className?: string })` and `SiteHeader()`.

- [ ] **Step 1: Write the failing header behavior test**

Create `src/components/layout/site-header.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("opens and closes the mobile navigation with an announced state", () => {
    render(<SiteHeader />);
    const toggle = screen.getByRole("button", { name: "Open navigation" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
```

- [ ] **Step 2: Run the header test and verify the RED state**

Run: `pnpm.cmd test -- src/components/layout/site-header.test.tsx`

Expected: FAIL because `site-header.tsx` does not exist.

- [ ] **Step 3: Implement the brand mark and header**

Create a reusable `BrandMark` from a Lucide botanical icon and implement `SiteHeader` as a narrow Client Component. Include native anchor links, a desktop CTA to `#moods`, an icon-library menu/close control with the exact accessible names from the test, `aria-expanded`, `aria-controls`, and a mobile panel that closes when a navigation link is activated.

- [ ] **Step 4: Run the header test**

Run: `pnpm.cmd test -- src/components/layout/site-header.test.tsx`

Expected: PASS.

### Task 5: Build and Test the Mood Ritual

**Files:**
- Create: `src/components/ui/mood-icon.tsx`
- Create: `src/components/home/mood-ritual.test.tsx`
- Create: `src/components/home/mood-ritual.tsx`

**Interfaces:**
- Consumes: `MoodId`, `moods`, `validateMomentText`, and `createMomentConfirmation`.
- Produces: `MoodIcon({ mood, className? })` and `MoodRitual()`.

- [ ] **Step 1: Write the failing interaction tests**

Create `src/components/home/mood-ritual.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoodRitual } from "./mood-ritual";

describe("MoodRitual", () => {
  it("updates the selected mood through an accessible pressed state", () => {
    render(<MoodRitual />);
    const calm = screen.getByRole("button", { name: "Calm" });
    fireEvent.click(calm);
    expect(calm.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Moments of ease, clarity, and quiet.")).not.toBeNull();
  });

  it("focuses the textarea and announces validation for an empty moment", () => {
    render(<MoodRitual />);
    const field = screen.getByLabelText("What is one moment that made you feel this way?");
    fireEvent.click(screen.getByRole("button", { name: "Create this moment" }));
    expect(document.activeElement).toBe(field);
    expect(
      screen.getByText("Write a few words about the moment you want to remember."),
    ).not.toBeNull();
  });

  it("shows a non-persistent preview confirmation for valid input", () => {
    render(<MoodRitual />);
    const field = screen.getByLabelText("What is one moment that made you feel this way?");
    fireEvent.change(field, { target: { value: "Rain tapping against the glass" } });
    fireEvent.click(screen.getByRole("button", { name: "Create this moment" }));
    expect(screen.getByText("Your Happy moment is ready in this preview.")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the ritual tests and verify the RED state**

Run: `pnpm.cmd test -- src/components/home/mood-ritual.test.tsx`

Expected: FAIL because `mood-ritual.tsx` does not exist.

- [ ] **Step 3: Implement the typed icon map**

Map the six `MoodId` values to distinct Lucide icons. Mark each icon `aria-hidden="true"`; the adjacent mood label remains visible.

- [ ] **Step 4: Implement the ritual behavior and states**

Create a Client Component with Happy selected initially, six native mood buttons, `aria-pressed`, the selected label/description, a labelled 120-character textarea, live character count, empty-input validation with focus restoration, and an `aria-live="polite"` success message that explicitly says “preview.”

- [ ] **Step 5: Run the ritual and pure behavior tests**

Run:

```powershell
pnpm.cmd test -- src/components/home/mood-ritual.test.tsx src/lib/mood-ritual.test.ts
pnpm.cmd typecheck
```

Expected: both commands PASS.

### Task 6: Build the Editorial Homepage Sections

**Files:**
- Create: `src/components/home/hero.tsx`
- Create: `src/components/home/recent-moments.tsx`
- Create: `src/components/home/memory-timeline.tsx`
- Create: `src/components/home/quote-section.tsx`
- Create: `src/components/layout/site-footer.tsx`
- Create: `src/app/page.test.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `SiteHeader`, `MoodRitual`, `BrandMark`, `MoodIcon`, `recentMoments`, and `timelineMoments`.
- Produces: `Hero`, `RecentMoments`, `MemoryTimeline`, `QuoteSection`, `SiteFooter`, and the complete `/` page.

- [ ] **Step 1: Write the failing page integration test**

Create `src/app/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Mood & Moments homepage", () => {
  it("renders the complete single-page experience with semantic landmarks", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Capture the moments. Feel the memories.",
      }),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Recent Moments" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Memory Timeline" })).not.toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("contentinfo")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the page test and verify the RED state**

Run: `pnpm.cmd test -- src/app/page.test.tsx`

Expected: FAIL because the starter page does not contain the approved experience.

- [ ] **Step 3: Implement the hero**

Use a two-column desktop layout with the approved headline, supporting copy, `#moods` primary CTA, `#moments` secondary CTA, botanical atmosphere image, and integrated `MoodRitual`. Stack content before ritual on mobile.

- [ ] **Step 4: Implement recent moments**

Render exactly three semantic `article` elements from `recentMoments`. Alternate image and content order on desktop, stack them on mobile, use `next/image` with explicit dimensions and responsive `sizes`, and show date/time, labelled mood, title, excerpt, and a decorative arrow icon.

- [ ] **Step 5: Implement the timeline**

Render `timelineMoments` as an ordered list with real `time dateTime`, visible date/time, icon plus mood label, title, excerpt, a continuous vertical rhythm, and responsive date-first mobile blocks.

- [ ] **Step 6: Implement the quote and footer**

Create the approved quote band using the botanical dusk image with a dark overlay. Create a restrained footer with the brand description, the real page anchors, and `© 2026 Mood & Moments. All rights reserved.` Do not add newsletter, social, policy, or nonexistent-route controls from the mockup.

- [ ] **Step 7: Compose the page**

Replace the starter screen in `src/app/page.tsx` with a single semantic structure: `SiteHeader`, `main` containing `Hero`, `RecentMoments`, `MemoryTimeline`, and `QuoteSection`, followed by `SiteFooter`.

- [ ] **Step 8: Run the page test and full test suite**

Run:

```powershell
pnpm.cmd test -- src/app/page.test.tsx
pnpm.cmd test
```

Expected: PASS with three recent-moment articles and all interaction tests green.

### Task 7: Apply the Approved Visual System and Metadata

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: all section markup and the approved color, typography, spacing, responsive, motion, and accessibility rules.
- Produces: project metadata, self-hosted Cormorant Garamond/Geist variables, global theme tokens, and final visual behavior.

- [ ] **Step 1: Update metadata and fonts**

Set the title to `Mood & Moments — Capture what matters` and describe the product as a quiet place to notice feelings and hold onto meaningful moments. Load variable Cormorant Garamond for expressive headings and Geist for body/interface text through `next/font/google`; expose both as CSS variables on `<html>`.

- [ ] **Step 2: Define the color and typography tokens**

In `globals.css`, preserve `@import "tailwindcss"` and define the approved charcoal, elevated, surface, muted surface, burgundy, rose, lavender, champagne, warm text, secondary text, and border tokens. Map the font variables into Tailwind’s `@theme inline` block.

- [ ] **Step 3: Add global structure and accessible states**

Set dark-only color-scheme and body defaults, smooth anchor scrolling, scroll margins, selection colors, visible `:focus-visible` outlines, readable text rendering, and `overflow-x: clip`. Keep controls inheriting the body font.

- [ ] **Step 4: Add restrained atmosphere and motion**

Use low-opacity background images, solid/translucent surfaces, subtle borders, shadow, and blur. Add only fade/slide entrance and small hover/selected transitions; disable smooth scrolling and nonessential animation inside `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 5: Verify tests, lint, and types after styling**

Run:

```powershell
pnpm.cmd test
pnpm.cmd lint
pnpm.cmd typecheck
```

Expected: all commands PASS with no warnings introduced by the UI.

### Task 8: Production, Interaction, Responsive, and Design QA

**Files:**
- Create: `design-qa.md`
- Modify: only files implicated by concrete verification failures.

**Interfaces:**
- Consumes: the complete homepage and approved Option 3 image.
- Produces: production-build evidence, HTTP smoke evidence, responsive and interaction findings, and a blocking visual comparison report.

- [ ] **Step 1: Run all automated verification**

Run:

```powershell
pnpm.cmd test
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd build
```

Expected: every command exits 0.

- [ ] **Step 2: Start the development server and smoke-test HTTP**

Run `pnpm.cmd dev` in a persistent session, discover the bound local port from its output, request `/`, and require HTTP 200. Keep the preview process running through visual review.

- [ ] **Step 3: Verify the core interaction path**

In the user-selected browser, verify navigation anchors, mobile menu open/close, all six mood buttons, pressed state, character count, empty validation, focus restoration, and valid preview confirmation.

- [ ] **Step 4: Verify responsive layouts**

Inspect matching desktop reference dimensions plus representative laptop, tablet, mobile, and small-mobile widths. Check navbar behavior, hero stack, three-column mood grid, alternate-to-stacked moments, date-first timeline, touch targets, text wrapping, image crops, and horizontal overflow.

- [ ] **Step 5: Compare source and implementation**

Capture the implementation at the same desktop viewport/state as `docs/superpowers/specs/mood-and-moments-homepage-option-3.png`, open both images together, and record concrete P0/P1/P2/P3 differences in `design-qa.md`. Fix all P0/P1/P2 issues and repeat until the report ends with `final result: passed`. If browser capture is unavailable, record `final result: blocked` and do not claim visual verification passed.

- [ ] **Step 6: Run the final regression gate**

After QA fixes, rerun:

```powershell
pnpm.cmd test
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd build
git diff --check
git status --short --branch
```

Expected: all quality commands exit 0; Git reports only intentional uncommitted files and changes; no commit or push occurs.
