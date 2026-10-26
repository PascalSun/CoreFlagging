#!/usr/bin/env python3
"""Tell IndexNow (Bing, which feeds ChatGPT search and Copilot; Yandex and others share it) about every
CoreFlagging page for near-instant (re)indexing, instead of waiting for a crawl.

Run it after a deploy that changes pages:  python3 deployment/indexnow.py

It reads the live sitemap, so only run it once the deploy is up. The key is published at
https://coreflagging.nlp-tlp.org/<KEY>.txt (frontend/public/), which is how IndexNow proves we own the host.
Stdlib only.
"""
import json
import re
import urllib.error
import urllib.request

KEY = "56254225a263ac7428d749caec944f57"
HOST = "coreflagging.nlp-tlp.org"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"


def main():
    sm_req = urllib.request.Request(f"https://{HOST}/sitemap.xml", headers={"User-Agent": UA})
    sitemap = urllib.request.urlopen(sm_req, timeout=30).read().decode()
    urls = re.findall(r"<loc>([^<]+)</loc>", sitemap)
    body = json.dumps({
        "host": HOST, "key": KEY, "keyLocation": f"https://{HOST}/{KEY}.txt",
        "urlList": urls,
    }).encode()
    req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body,
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        print(f"IndexNow OK (HTTP {resp.status}) - submitted {len(urls)} URLs")
    except urllib.error.HTTPError as e:
        print(f"IndexNow HTTP {e.code}: {e.read().decode()[:200]} - submitted {len(urls)} URLs")


if __name__ == "__main__":
    main()
