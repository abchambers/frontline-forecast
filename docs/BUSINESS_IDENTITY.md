# What Frontline Forecast actually is — three lines of business, not one

This file exists so future work (AI-assisted or not) doesn't default back to
treating this as a school-only product. As of 2026-08, the real scope is
broader, and it should shape priorities, not just get mentioned once and
forgotten.

## The three segments

1. **Schools (B2B2C)** — the original product: a weather-forecasting
   education platform for classrooms. Instructors and students use it under
   a school-sponsored account; some students are minors. FERPA/COPPA-via-
   school apply here. This is the most built-out segment today.
2. **Individual consumers (B2C)** — hobby weather enthusiasts and the
   general public, signing up directly with no school in the middle. Two
   planned paid tiers: one for forecasting tools, one for premium weather
   features that are still in development. This segment has real exposure
   the school segment doesn't — standalone COPPA (no institutional consent
   gatekeeper), consumer auto-renewal billing law, CCPA/CPRA.
3. **Future: radar/model data API (B2B/B2Dev)** — not launched yet.
   Licensing access to Frontline Forecast's own in-house radar and model
   rendering to other developers or companies, the same way Xweather,
   OpenWeatherMap, and Windy license their tile/data products today.
   Explicitly gated on the in-house radar quality actually being good
   enough to depend on — see the note below.

Each segment has its own buyer, sales motion, cost structure, and legal
exposure. See `founder-docs` prepared for the attorney/formation process
(not checked into this repo — request them again if needed) for the detailed
breakdown per segment: pricing, unit economics, staffing timing, and the
Terms/Privacy fork between "School-Sponsored Accounts" and "Individual
Accounts."

## What this means for day-to-day work in this repo

- Don't assume every feature request is education-only. When something is
  genuinely school-specific (grading rubrics, classroom rosters, FERPA-scoped
  data handling), fine — build it that way. But general product surfaces
  (forecast tools, radar, account settings, billing) should be built with
  the individual-consumer path in mind too, not retrofitted onto a
  school-shaped data model later.
- Keep school data and individual-consumer data conceptually separate. A
  student's classroom data should never be used for, or merged into, the
  individual consumer or future API businesses. This isn't just a legal
  requirement — it's also what lets a district's data-privacy review pass
  during procurement.
- The API/data-licensing line is intentionally sequenced last. Per direct
  instruction: **do not build the model-maps / API product on top of the
  current in-house radar rendering until the radar visual quality itself is
  fixed.** The API business is only worth as much as the underlying data
  product is trustworthy — shipping an API on a radar pipeline that still
  looks noticeably worse than reference apps (RadarScope-grade smoothness,
  storm rendering) would undercut the exact customers this line depends on.
- Individual self-service billing introduces real payment-compliance and
  support-cost surface area that the school business never had (payment
  processor integration, chargebacks, auto-renewal disclosure, higher support
  ticket volume with no institutional IT layer absorbing it first). Don't
  treat "add a Stripe checkout" as a small task — see the cost-analysis and
  staffing documents for what actually comes with it.

## Where this stands today (2026-08)

Proof-of-concept / early-pilot stage. No signed school customers, no live
individual billing, no formed legal entity yet, no launched API. The
consumer product and its two tiers exist conceptually in the live app, but
formal billing/subscription enforcement for individuals is not yet built.
Treat this section as a snapshot, not a source of truth for current state —
check the actual code and `git log` for what's really shipped.
