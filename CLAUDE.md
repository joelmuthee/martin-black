# Martin Black — project rules for Claude (READ BEFORE EDITING)

New-stock men's footwear catalog. Global rules: `~/.claude/CLAUDE.md`. Catalog rules:
`Website Designs/CATALOG-STANDARDS.md`. **This file lists Martin-specific LOCKED decisions
that OVERRIDE the standard. Do not revert them across sessions without Joel's explicit say-so.**

## LOCKED DECISIONS — do NOT undo

1. **Button label = "Check availability" (NOT "Enquire").** Plain everyday language per the copy
   standard. Sold-out variant stays "Sold out · notify me". The WhatsApp message body matches:
   *"I'd like to check availability of *<Item>*…"* (not "I'd like to enquire about…"). Same for
   the wishlist drawer ("Check availability for all") and the How-to-buy step. Internal
   identifiers (`enquireBody`, `.btn-card.primary` selector, GA event names if any) stay as-is —
   visible text and code symbols are intentionally decoupled.

2. **No "View on IG" button on cards.** Removed because Martin's product photos were captured
   from Reels — the original IG links go to videos, not product photos, so clicking them is
   confusing for buyers. The `${item.instagramUrl ? <a class="btn-card ig">…</a> : ''}` block
   was deleted from `main.js`'s card template. Do NOT re-add it even though the global catalog
   standard ships one on IG-sourced catalogs. The `itemIgClicks` admin KPI / tracking is left
   in place (historical data) but will stop incrementing — that's expected, not a bug.

3. **Empty-publish guard is live on `/api/bulk`** (was already present). A POST with `{bags:[]}`
   is rejected unless the caller passes `force:true`. Don't remove it.

## Infra (Stawisystems CF account `58685495706b973821d77208248c66fc`)
- Worker `martin-black-api`; KV `BAGS` id `2c1e307a58164478a2b4532643b07f51`.
- Repo `github.com/joelmuthee/martin-black` with `.github/workflows/deploy.yml`
  (auto-deploys Pages + worker on push to `main`; needs repo secret `CLOUDFLARE_API_TOKEN`).
- Pages project `martin-black`; domains `martin-black.pages.dev` and
  `martin-black.essenceautomations.com`.
- WhatsApp `254710307797`. M-Pesa Till `5347003`. Shop: Nairobi CBD.

## Deploy
Bump `?v=` query in `index.html`/`admin.html` on CSS/JS change, then `git push` — GH Actions
deploys both Pages and worker.
