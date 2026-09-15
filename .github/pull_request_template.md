<!--
Delete the sections that genuinely do not apply, but do not delete a section
because the answer is inconvenient. "Migration? none" is a fine answer;
a missing Migration section is not.
-->

## What

<!-- One or two sentences. What a student can now do that they could not before,
     or what stopped being broken. Not a list of files touched. -->

## Why

<!-- The problem this solves, and how it was found: a device pass, a Sentry
     issue, a founder report, an audit finding. Link it. -->

## How verified

- [ ] `npm run build` (full turbo graph)
- [ ] `npm run typecheck --workspace=@lantern/mobile`
- [ ] `npx jest --no-cache` in `apps/mobile`
- [ ] `npm run design:contrast`
- [ ] `bash scripts/check-secrets.sh`
- [ ] `node scripts/check-migrations.mjs`

Device / web pass:

<!-- Which build, which device or browser, what you actually did. A screenshot
     of a screen that renders is not proof the flow works — say what you tapped
     and what came back. -->

## Migration?

- File: <!-- supabase/migrations/2026…_name.sql, or "none" -->
- Applied to the linked project? <!-- yes / no — if no, say who applies it and when -->
- Idempotent and additive? <!-- the `migrations` CI job checks this; if it needed
      a `-- destructive: approved` marker, say why here -->

## Release?

- Mobile version bump: <!-- app.config.ts version, or "no" -->
- Feature registry updated: <!-- yes / no / [skip registry] and why -->

## Screenshots

<!-- Before and after for anything visual. Both themes if it touches colour. -->

## Risk + rollback

- Blast radius: <!-- who is affected if this is wrong -->
- Rollback: <!-- revert the PR and let deploy-web/deploy-api re-run? or does it
      need a migration reversed, a release rolled back, a cache cleared? If a
      revert is not enough, write the actual steps. -->
