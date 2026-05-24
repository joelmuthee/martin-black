#!/usr/bin/env python3
"""Seed the Martin Black catalog from the Instagram feed.

Pulls the profile feed via the worker's /api/ig-feed (which proxies
/api/v1/feed/user/<id>/), parses captions + hashtags for a product name,
category, EU/UK sizes and price, SKIPS posts that don't yield a real name
(no placeholder entries), then commits via /api/ig-sync (downloads images
to KV, builds new-stock bags, dedupes by ig_<shortcode>).

Usage:
  python tools/seed_from_ig.py --dry-run        # parse + report only
  python tools/seed_from_ig.py --max 150         # parse + commit
"""
import sys, json, re, html, time, argparse, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8")

API = "https://martin-black-api.stawisystems.workers.dev"
UID = "6327094556"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# --- brand/model -> (canonical name, category). Searched in body + hashtags. ---
# Order matters: most specific first.
BRANDS = [
    (r"air\s*force|\baf1\b|airforce", "Nike Air Force 1", "Sneakers"),
    (r"air\s*max|airmax", "Nike Air Max", "Sneakers"),
    (r"\bjordan\s*1\b|\baj1\b|\bj1\b", "Jordan 1", "Sneakers"),
    (r"\bjordan\s*3\b|\bj3\b", "Jordan 3", "Sneakers"),
    (r"\bjordan\s*4\b|\baj4\b|\bj4\b", "Jordan 4", "Sneakers"),
    (r"\bjordan\s*6\b|\bj6\b", "Jordan 6", "Sneakers"),
    (r"\bjordan\s*11\b|\baj11\b|\bj11\b", "Jordan 11", "Sneakers"),
    (r"\bjordan\b|\bairjordan\b", "Jordan", "Sneakers"),
    (r"yeezy", "Adidas Yeezy", "Sneakers"),
    (r"\bdunk", "Nike Dunk", "Sneakers"),
    (r"cortez", "Nike Cortez", "Sneakers"),
    (r"blazer", "Nike Blazer", "Sneakers"),
    (r"samba", "Adidas Samba", "Sneakers"),
    (r"gazelle", "Adidas Gazelle", "Sneakers"),
    (r"superstar", "Adidas Superstar", "Sneakers"),
    (r"stan\s*smith", "Adidas Stan Smith", "Sneakers"),
    (r"ultra\s*boost|ultraboost", "Adidas Ultraboost", "Sneakers"),
    (r"\bnmd\b", "Adidas NMD", "Sneakers"),
    (r"\bvans?\b", "Vans", "Sneakers"),
    (r"converse|all\s*star|allstar", "Converse", "Sneakers"),
    (r"timberland|\btimbs?\b", "Timberland Boots", "Boots"),
    (r"dr\.?\s*martens|doc\s*martens|\bdms\b", "Dr Martens", "Boots"),
    (r"chelsea\s*boot", "Chelsea Boots", "Boots"),
    (r"\bclarks\b", "Clarks", "Loafers"),
    (r"\bcrocs?\b", "Crocs", "Slides"),
    (r"new\s*balance|\bnb\b", "New Balance", "Sneakers"),
    (r"\bpuma\b", "Puma", "Sneakers"),
    (r"\basics\b", "Asics", "Sports/Athletic"),
    (r"reebok", "Reebok", "Sneakers"),
    (r"\bfila\b", "Fila", "Sneakers"),
    (r"\bnike\b", "Nike", "Sneakers"),
    (r"\badidas\b", "Adidas", "Sneakers"),
]
# Generic footwear-type keywords -> category (used when no brand matched but a
# real descriptive name exists on line 1).
TYPE_CAT = [
    (r"loafer|moccasin|moccasins|driving\s*shoe|boat\s*shoe", "Loafers"),
    (r"oxford|derby|brogue|official|formal|dress\s*shoe", "Formal"),
    (r"\bslides?\b|slider|flip\s*flop|slipper", "Slides"),
    (r"\bsandals?\b", "Slides"),
    (r"\bboots?\b", "Boots"),
    (r"running|football|soccer|sport|athletic|training|trainer", "Sports/Athletic"),
    (r"sneaker|rubber\s*shoe|canvas|\bkicks?\b", "Sneakers"),
]
# Line-1 phrases that are NOT product names (marketing / price / logistics).
GENERIC_LINE = re.compile(
    r"^(quality\s+(shoes?|sneakers?|kicks?)\s*(only)?|new\s+(arrivals?|stock|in)|"
    r"available|in\s*stock|back\s*in\s*stock|restock|grab\s+yours|order\s+now|"
    r"countrywide\s+delivery|dm\s+to\s+order|hello+|good\s+(morning|afternoon))\b",
    re.I)
NONNAME = re.compile(r"^(ksh|kshs|bob|@?\d|sizes?\b|size\b|colou?rs?\b|"
                     r"black\b|white\b|brown\b|0\d{6,}|\W*$)", re.I)


def clean_name(s):
    s = re.sub(r"#[^\s#]+", "", s)            # strip hashtags
    s = re.sub(r"[•⭐✨🔥💯☎️📞🚚]+", "", s)         # strip emoji decals
    s = re.sub(r"\s+", " ", s).strip(" .-•|").strip()
    return s


def title(s):
    return re.sub(r"\b\w", lambda m: m.group().upper(), s)


def parse_sizes(text):
    """Return a stock dict {size: 1}. Handles EU ranges/lists + UK sizes."""
    stock = {}
    low = text.lower()
    # UK sizes: "uk 7-11", "uk7", "size uk 9"
    for m in re.finditer(r"uk\s*(\d{1,2})\s*[-to]+\s*(\d{1,2})", low):
        a, b = int(m.group(1)), int(m.group(2))
        for n in range(min(a, b), max(a, b) + 1):
            if 3 <= n <= 14:
                stock[f"UK{n}"] = 1
    for m in re.finditer(r"uk\s*(\d{1,2})\b", low):
        n = int(m.group(1))
        if 3 <= n <= 14:
            stock[f"UK{n}"] = 1
    # EU ranges: "sizes 36 - 45", "38-45", "size 40 to 45"
    for m in re.finditer(r"(?:sizes?\s*)?(\d{2})\s*[-–to]+\s*(\d{2})", low):
        a, b = int(m.group(1)), int(m.group(2))
        if 35 <= a <= 48 and 35 <= b <= 48 and b >= a:
            for n in range(a, b + 1):
                stock[str(n)] = 1
    # EU comma list: "sizes 40,42,44"
    msec = re.search(r"sizes?\s*[:\-]?\s*([\d ,/]+)", low)
    if msec and not stock:
        for tok in re.findall(r"\d{2}", msec.group(1)):
            n = int(tok)
            if 35 <= n <= 48:
                stock[str(n)] = 1
    # single "size 42"
    if not stock:
        for m in re.finditer(r"\bsize\s*(\d{2})\b", low):
            n = int(m.group(1))
            if 35 <= n <= 48:
                stock[str(n)] = 1
    return stock


def parse_price(text):
    m = re.search(r"(?:ksh|kshs|bob)\s*\.?\s*([\d,]{3,7})", text, re.I)
    if not m:
        m = re.search(r"\b([\d,]{1,3}(?:,\d{3})+)\b", text)  # 2,999 style
    if not m:
        return 0
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return 0


def find_brand(text):
    low = text.lower()
    for pat, name, cat in BRANDS:
        if re.search(pat, low):
            return name, cat
    return None, None


# Cut a name candidate at the first noise marker (colour / size / price /
# 2-4 digit number / slash / CTA). Works for newline feed captions AND the
# single-line captions returned by /api/ig-fetch's embed page.
NOISE_CUT = re.compile(
    r"(\bsizes?\b|\bksh\b|\bkshs\b|\bbob\b|\bavailable\b|countrywide|delivery|"
    r"\bcolou?rs?\b|\b(?:black|white|brown|blue|red|grey|gray|green|cream|beige|"
    r"navy|gum|tan|maroon|multi(?:colou?r)?)\b|[/\n@]|\b\d{2,4}\b)", re.I)


def classify(caption):
    """Return (name, category, stock, price, sold) or (None,...) to skip."""
    cap = html.unescape(caption or "")
    cap = re.sub(r"^[a-z0-9._]+\s+", "", cap) if cap[:30].lower().startswith("martinblack") else cap

    brand_name, brand_cat = find_brand(cap)

    # Name candidate = text before the first noise marker.
    head = cap.split("\n")[0] if "\n" in cap else cap
    m = NOISE_CUT.search(head)
    seg = clean_name(head[:m.start()] if m else head)
    seg_ok = seg and 3 <= len(seg) <= 40 and not NONNAME.match(seg) and not GENERIC_LINE.match(seg)

    name = title(seg) if seg_ok else (brand_name if brand_name else None)
    if not name:
        return None, None, None, 0, False   # SKIP — no name yielded

    # Category
    category = brand_cat
    if not category:
        for pat, c in TYPE_CAT:
            if re.search(pat, cap.lower()):
                category = c
                break
    if not category:
        category = "Sneakers"   # shoe-shop default

    stock = parse_sizes(cap)
    price = parse_price(cap)
    sold = bool(re.search(r"\bsold(?:\s*out)?\b", cap, re.I))
    return name, category, stock, price, sold


def build_desc(name, caption, stock):
    cap = html.unescape(caption or "")
    # pull a colour line if present
    colour = ""
    for l in cap.split("\n"):
        ls = l.strip()
        if re.match(r"^(black|white|brown|blue|red|grey|gray|green|cream|beige|"
                    r"navy|gum|tan)([ /].*)?$", ls, re.I) and len(ls) <= 40:
            colour = ls.replace("/", " / ")
            break
    eu = sorted(int(s) for s in stock if s.isdigit())
    sizes_txt = f"Available in EU {eu[0]}-{eu[-1]}. " if eu else ""
    head = f"{colour}. " if colour else ""
    return (f"{head}{sizes_txt}Hand-picked, inspected before listing. "
            f"Tap Enquire to confirm your size on WhatsApp.")


def get(url, tries=8):
    """GET JSON with retry/backoff. IG feed paths are flaky (transient 401/502
    rate-limits that clear after a short cooldown)."""
    last = None
    for t in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            d = json.load(urllib.request.urlopen(req, timeout=90))
            if isinstance(d, dict) and d.get("error") and not d.get("items"):
                last = d.get("error")
                time.sleep(min(4 + 4 * t, 30))
                continue
            return d
        except Exception as e:
            last = e
            time.sleep(min(4 + 4 * t, 30))
    raise RuntimeError(f"feed fetch failed after {tries} tries: {last}")


CACHE = ".tmp/ig_posts.json"


def _load_cache():
    try:
        return json.load(open(CACHE, encoding="utf-8"))
    except Exception:
        return []


def _save_cache(posts):
    import os
    os.makedirs(".tmp", exist_ok=True)
    json.dump(posts, open(CACHE, "w", encoding="utf-8"))


STATE = ".tmp/ig_state.json"


def load_state():
    try:
        s = json.load(open(STATE, encoding="utf-8"))
        return s.get("cursor", ""), s.get("committed", [])
    except Exception:
        return "", []


def save_state(cursor, committed):
    import os
    os.makedirs(".tmp", exist_ok=True)
    json.dump({"cursor": cursor, "committed": sorted(committed)},
              open(STATE, "w", encoding="utf-8"))


def make_item(it, imgs):
    name, cat, stock, price, sold = classify(it.get("caption", ""))
    if not name:
        return None
    return {
        "shortcode": it["shortcode"],
        "name": name,
        "category": cat,
        "stock": stock,
        "price": price,
        "description": build_desc(name, it.get("caption", ""), stock),
        "imageUrls": it.get("imageUrls", [])[:imgs],
        "takenAt": it.get("takenAt"),
    }


def post_sync(items, token):
    body = json.dumps({"items": items}).encode()
    req = urllib.request.Request(f"{API}/api/ig-sync", data=body, method="POST",
                                 headers={"User-Agent": UA, "Content-Type": "application/json",
                                          "Authorization": f"Bearer {token}"})
    return json.load(urllib.request.urlopen(req, timeout=180))


def fetch_one(cursor):
    url = f"{API}/api/ig-feed?user_id={UID}&count=50"
    if cursor:
        url += "&max_id=" + urllib.parse.quote(cursor)
    return get(url)            # raises RuntimeError if it can't get past the throttle


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=150)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--imgs", type=int, default=2)
    ap.add_argument("--budget-min", type=float, default=40.0, help="wall-clock budget")
    ap.add_argument("--reset", action="store_true", help="ignore saved cursor, start at feed head")
    args = ap.parse_args()

    token = ""
    try:
        token = open(".tmp_secrets").read().splitlines()[1]
    except Exception:
        pass
    if not token and not args.dry_run:
        print("ERROR: no admin token found (.tmp_secrets).")
        sys.exit(1)

    cursor, committed_list = ("", []) if args.reset else load_state()
    committed = set(committed_list)
    # Seed from what's already in the live catalog so we never re-attempt them.
    try:
        bags = get(f"{API}/api/bags").get("bags", [])
        for b in bags:
            bid = b.get("id", "")
            if bid.startswith("ig_"):
                committed.add(bid[3:])
    except Exception:
        pass
    print(f"Resuming: cursor={'<head>' if not cursor else cursor[:24]+'...'} "
          f"already-committed={len(committed)}")

    deadline = time.time() + args.budget_min * 60
    throttle = 90          # grows on repeated throttle
    page = 0
    added_total, skipped_total = 0, 0

    while len(committed) < args.max and time.time() < deadline:
        try:
            d = fetch_one(cursor)
            throttle = 90  # reset backoff on success
        except RuntimeError as e:
            wait = min(throttle, max(10, int(deadline - time.time())))
            print(f"  throttled ({e}); waiting {wait}s then retrying same cursor")
            time.sleep(wait)
            throttle = min(throttle + 60, 300)
            continue

        page += 1
        items = d.get("items", [])
        fresh = [it for it in items if it.get("shortcode") not in committed and it.get("imageUrls")]
        keepers, skipped = [], 0
        for it in fresh:
            mi = make_item(it, args.imgs)
            if mi:
                keepers.append(mi)
            else:
                skipped += 1
        skipped_total += skipped

        if keepers and not args.dry_run:
            try:
                r = post_sync(keepers, token)
                for k in keepers:
                    committed.add(k["shortcode"])
                added_total += r.get("added", 0)
                print(f"  page {page}: +{len(keepers)} named (skip {skipped}) "
                      f"committed +{r.get('added')} errs {len(r.get('errors', []))} "
                      f"| total {len(committed)} more={d.get('more_available')}")
            except Exception as e:
                print(f"  page {page}: commit EXCEPTION {e}")
        else:
            for k in keepers:
                committed.add(k["shortcode"])
            print(f"  page {page}: +{len(keepers)} named (skip {skipped}) "
                  f"[dry] total {len(committed)} more={d.get('more_available')}")

        cursor = d.get("next_max_id") or ""
        if not args.reset:
            save_state(cursor, committed)
        if not d.get("more_available") or not cursor:
            print("  reached end of feed.")
            break
        time.sleep(4)

    print(f"\nDONE. committed_total={len(committed)} added_this_run={added_total} "
          f"skipped_this_run={skipped_total}")


if __name__ == "__main__":
    main()
