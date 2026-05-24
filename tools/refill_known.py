#!/usr/bin/env python3
"""Reliable catalog refill via the per-post embed endpoint (/api/ig-fetch),
which is NOT rate-limited like the feed pagination. Uses a known list of
shortcodes (captured from earlier feed pulls) plus a best-effort feed probe
to extend it, classifies each caption, and commits named items via /api/ig-sync.
"""
import sys, os, time, json, urllib.request, urllib.parse
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from seed_from_ig import classify, build_desc, post_sync, get, API, UID, UA

# Shortcodes captured from feed pages 1-3 (named + skipped — classify() decides).
KNOWN = [
    "DYmCCiJlQao","DYmBZSno4wU","DYmBWHIIeY8","DYjfKzNFY2h","DYjT9ZYoJkt",
    "DYjTzs9oLFn","DYWjnmgoedl","DYWjd0KIYRZ","DYWjab0IhOT","DYO6PybCEwO",
    "DXyni2diMrY","DXyngHeiNnL","DXynd11iA6S","DXynZyJiPlU","DXwSuL4CKrm",
    "DXwRXD1FcWQ","DXtPyN1iB95","DXtPtX_CCDu","DXtPo8gCNYF","DXtPlHIiB_o",
    "DXrNu_fCK0e","DXj5_LOCOBU","DXj5xQfCBQJ","DXj5knNiJ8V","DXj5UFNCBre",
    "DXMT6OJiAFO","DXEZZkMiFAZ","DXEMxIUCIZ_","DXEMnE5CMCj","DXEMiqRiCks",
    "DXEMAUxiFVv","DW8vfw6iFWB","DXbnTi2iHw2","DXHX9GACM1o","DXGu9tCiBEP",
    "DXGu57FCIjC",
]


def fetch_post(sc):
    url = f"{API}/api/ig-fetch?url=https://www.instagram.com/p/{sc}/"
    return get(url, tries=4)


def feed_probe(max_pages=8):
    """Best-effort: grab more shortcodes (+imageUrls) from the feed if the
    throttle happens to be open. Returns {shortcode: {imageUrls, caption}}."""
    out, cursor = {}, ""
    for _ in range(max_pages):
        u = f"{API}/api/ig-feed?user_id={UID}&count=50"
        if cursor:
            u += "&max_id=" + urllib.parse.quote(cursor)
        try:
            d = get(u, tries=2)
        except Exception:
            break
        for it in d.get("items", []):
            sc = it.get("shortcode")
            if sc and it.get("imageUrls"):
                out[sc] = {"imageUrls": it["imageUrls"], "caption": it.get("caption", ""),
                           "takenAt": it.get("takenAt")}
        cursor = d.get("next_max_id") or ""
        if not d.get("more_available") or not cursor:
            break
        time.sleep(2)
    return out


def main():
    token = open(".tmp_secrets").read().splitlines()[1]
    already = set()
    try:
        for b in get(f"{API}/api/bags").get("bags", []):
            if b.get("id", "").startswith("ig_"):
                already.add(b["id"][3:])
    except Exception:
        pass

    print("Feed probe (best effort)...")
    feed = feed_probe()
    print(f"  feed gave {len(feed)} shortcodes")

    codes = list(dict.fromkeys(list(feed.keys()) + KNOWN))
    codes = [c for c in codes if c not in already]
    print(f"Resolving {len(codes)} posts via per-post embed ({len(already)} already in catalog)...\n")

    items = []
    for sc in codes:
        info = feed.get(sc)
        if not info:
            try:
                d = fetch_post(sc)
                info = {"imageUrls": d.get("imageUrls") or ([d["imageUrl"]] if d.get("imageUrl") else []),
                        "caption": d.get("caption", ""), "takenAt": d.get("takenAt")}
            except Exception as e:
                print(f"  {sc}: fetch fail ({e})")
                continue
        name, cat, stock, price, sold = classify(info["caption"])
        if not name:
            print(f"  {sc}: skip (no name)")
            continue
        if not info["imageUrls"]:
            print(f"  {sc}: skip (no image)")
            continue
        items.append({
            "shortcode": sc, "name": name, "category": cat, "stock": stock,
            "price": price, "description": build_desc(name, info["caption"], stock),
            "imageUrls": info["imageUrls"][:2], "takenAt": info.get("takenAt"),
        })
        eu = sorted(int(s) for s in stock if s.isdigit())
        szs = f"EU{eu[0]}-{eu[-1]}" if eu else (",".join(stock) or "none")
        print(f"  {sc}: {name[:32]:32} {cat:15} {szs:10} Ksh{price}")
        time.sleep(0.4)

    print(f"\nCommitting {len(items)} named items...")
    for i in range(0, len(items), 6):
        batch = items[i:i + 6]
        try:
            r = post_sync(batch, token)
            print(f"  batch {i//6+1}: added={r.get('added')} errs={len(r.get('errors', []))}")
        except Exception as e:
            print(f"  batch {i//6+1}: EXCEPTION {e}")
        time.sleep(1.0)
    print("DONE.")


if __name__ == "__main__":
    main()
