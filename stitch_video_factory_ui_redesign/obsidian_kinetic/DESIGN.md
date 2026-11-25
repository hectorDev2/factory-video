---
name: Obsidian Kinetic
colors:
  surface: '#111317'
  surface-dim: '#111317'
  surface-bright: '#37393d'
  surface-container-lowest: '#0c0e11'
  surface-container-low: '#1a1c1f'
  surface-container: '#1e2023'
  surface-container-high: '#282a2d'
  surface-container-highest: '#333538'
  on-surface: '#e2e2e6'
  on-surface-variant: '#e1bebd'
  inverse-surface: '#e2e2e6'
  inverse-on-surface: '#2f3034'
  outline: '#a98988'
  outline-variant: '#594040'
  surface-tint: '#ffb3b0'
  primary: '#ffb3b0'
  on-primary: '#680010'
  primary-container: '#ff5e62'
  on-primary-container: '#64000f'
  inverse-primary: '#b32631'
  secondary: '#d4bbff'
  on-secondary: '#41008b'
  secondary-container: '#6c04de'
  on-secondary-container: '#d4baff'
  tertiary: '#ffb4a3'
  on-tertiary: '#630f00'
  tertiary-container: '#f96746'
  on-tertiary-container: '#5f0e00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdad8'
  primary-fixed-dim: '#ffb3b0'
  on-primary-fixed: '#410007'
  on-primary-fixed-variant: '#91061d'
  secondary-fixed: '#ebdcff'
  secondary-fixed-dim: '#d4bbff'
  on-secondary-fixed: '#270058'
  on-secondary-fixed-variant: '#5d00c2'
  tertiary-fixed: '#ffdad2'
  tertiary-fixed-dim: '#ffb4a3'
  on-tertiary-fixed: '#3d0600'
  on-tertiary-fixed-variant: '#8c1900'
  background: '#111317'
  on-background: '#e2e2e6'
  surface-variant: '#333538'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.03em
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system targets high-velocity social media content directors, editors, and growth strategists producing short-form video (Reels, TikToks, Shorts) at agency scale. The interface embodies a professional studio workstation aesthetic: precise, hyper-focused, and luminous against deep optical black. 

The stylistic posture merges modern dark-mode utilitarian minimalism with targeted energetic neon accents. By maintaining deep obsidian structural layers, the UI recedes, pushing client video media to the foreground while surfacing critical operational signals—render queues, audio waveforms, viral hooks, and timeline statuses—with razor-sharp clarity. The tone is industrial-grade yet vibrant, avoiding the somber weight of legacy enterprise tools while delivering instantaneous visual feedback.

## Colors

The palette leverages high-contrast luminescence over multi-tiered obsidian base values. Functional zones and elevated surfaces rely on distinct dark-spectrum neutrals:
- **Base Canvas (`#0D0F12`):** Primary viewport backdrop, providing absolute baseline depth.
- **Surface Elevation 1 (`#15181E`):** Toolbars, asset card containers, navigation rails, and docked sidebars.
- **Surface Elevation 2 (`#1F242D`):** Active card states, modal dialogues, input fields, and scrubber beds.
- **Surface Border (`#2B323E`):** Subdued ghost borders ensuring structural division without visual noise.

Accent colors function exclusively as interactive cues, timeline playheads, and rendering states:
- **Kinetic Coral (`#FF5E62`):** Primary call-to-action, record/render triggers, active audio scrub heads, and hot viral performance indicators.
- **Electric Violet (`#8A3FFC`):** Multi-select batch automation, AI generation triggers, secondary navigation highlights, and audio pipeline states.
- **Vibrant Coral (`#FF6B4A`):** Alert thresholds, export queues, and active multi-track selections.
- **Signal Emerald (`#00E599`):** Render success, published status, and audio headroom safety.
- **Text Hierarchy:** High-emphasis copy uses `#F3F4F6`, medium-emphasis interface meta uses `#9CA3AF`, and low-emphasis secondary labels use `#64748B`.

## Typography

Typography balances high-density information displays with immediate readability. Headings employ **Plus Jakarta Sans** for an energetic, contemporary profile, while data labels, metadata tables, metrics, and video timelines rely on **Inter** for neutral clarity under compressed pixel limits.

- **Numerics & Timecodes:** Use tabular figures (`tnum`) for frame counters, aspect ratio readouts (9:16), durations, and bitrate counts to prevent visual jitter during real-time playback.
- **Labels & Micro-data:** Micro-copy (`label-sm`, `label-md`) is rendered in uppercase with wide tracking for immediate recognition over dense timeline elements.

## Layout & Spacing

The layout is built for high-density desktop monitoring and workstation editing using a docked, fluid modular panel grid:
- **Shell Structure:** Left utility rail (collapsed to 64px, expandable to 240px), dynamic multi-track asset canvas (flexible center), and contextual inspector panel (fixed 340px right).
- **Video Card Grid:** Asset vaults employ an auto-fill CSS grid with a minimum card width of 220px to comfortably showcase 9:16 aspect ratios alongside metadata overlays.
- **Vertical Rhythm:** A strict 4px base increment controls alignment across track layers, scrubber increments, and batch list queues. Outer margins conform to 24px (`space-xl`), retaining perimeter air while internal container gaps maintain dense operational layouts (`space-xs` through `space-md`).

## Elevation & Depth

Visual hierarchy uses tonal surface layering combined with low-contrast outlines and directed neon luminescence rather than standard drop shadows:

- **Level 0 (Basebed):** `#0D0F12` — Base workstation, unpadded gutter areas.
- **Level 1 (Docked Containers):** `#15181E` with a 1px structural boundary (`#1F242D`).
- **Level 2 (Interactive Floating/Cards):** `#1F242D` framed by a subtle 1px border (`#2B323E`).
- **Level 3 (Overlays & Dialogs):** `#15181E` backed by an active backdrop blur (`backdrop-filter: blur(16px)` with 80% opacity) and bordered with `#3E4656`.

**Glow Indicators:** Accent shadows are applied sparingly to active operational signals. Active render jobs and live preview playheads emit an ambient colored bloom (`0 0 16px rgba(255, 94, 98, 0.25)` for primary coral; `0 0 16px rgba(138, 63, 252, 0.25)` for secondary violet), delivering immediate situational awareness across crowded timelines.

## Shapes

The interface specifies a uniform roundedness scale centered on 10px–12px curves for primary cards and modular panels. This geometry balances sharp digital precision with ergonomic containment:
- **Base Components (Buttons, Inputs, Badges, Tabs):** 8px–10px (`rounded-md` / 0.5rem - 0.625rem).
- **Cards, Video Containers, and Modals:** 12px (`rounded-lg` / 0.75rem - 1rem).
- **Status Pills, Waveform Markers, and Scrubber Thumbs:** Full circular radius (`rounded-full`).

## Components

### Buttons & Action Triggers
- **Primary Studio Button:** Background of solid `#FF5E62`, foreground `#FFFFFF`, font `label-lg`, height 36px, radius 10px. Hover introduces an energetic micro-scale transition (`1.02`) and ambient glow (`0 0 12px rgba(255, 94, 98, 0.4)`).
- **Secondary Automation Button:** Background `#1F242D`, 1px border `#8A3FFC`, text `#F3F4F6`. Hover triggers background `#8A3FFC` with crisp white text.
- **Ghost Tool Actions:** Borderless `#15181E` base, text `#9CA3AF`, hover state `#1F242D` with `#FFFFFF` glyph.

### Video Asset Cards (9:16 Optimized)
- Compact cards with an aspect ratio preview container, encapsulated in `#15181E` with an inner 10px border-radius.
- Top-right floating chip displays export destination icon (TikTok, IG Reels, YT Shorts) with translucent slate background (`rgba(13, 15, 18, 0.75)`).
- Bottom metadata scrim hosts video duration (tabular mono), client badge, and direct review status indicator.

### Status Badges & Glow Chips
- Encapsulated pills (`height: 20px`, padding `0 8px`, `label-sm`).
- **Rendering:** Violet background tint (`rgba(138, 63, 252, 0.15)`), text `#C299FF`, anchored by a pulsating dot with `0 0 8px #8A3FFC`.
- **Approved / Ready:** Emerald tint (`rgba(0, 229, 153, 0.15)`), text `#00E599`, crisp static indicator.
- **Client Revision:** Coral tint (`rgba(255, 94, 98, 0.15)`), text `#FF5E62`.

### Waveform Indicators & Timeline Scrubbers
- Audio canvas height minimum 32px with reactive dual-tone vertical bars: processed tracks rendered in `#8A3FFC`, peaks exceeding client platform spec highlighted in `#FF5E62`.
- Playhead line is 2px crisp solid `#FF5E62` with an elevated 10px diamond scrubber head.

### Progress Queues & Processing Bars
- Slimline 4px tracks using `#1F242D` as track background.
- Filled indicator utilizes a continuous energetic gradient (`linear-gradient(90deg, #8A3FFC 0%, #FF5E62 100%)`) with a leading edge glow effect for active renders.

### Form Inputs & Dropdowns
- Sleek 36px inputs styled with `#15181E` background, 1px `#2B323E` structural border, and `#F3F4F6` text.
- Focus state activates a 1px border transition to `#FF5E62` and an ambient coral ring (`0 0 0 3px rgba(255, 94, 98, 0.15)`). Placeholder copy styled in `#64748B`.