"""Ulauncher extension: save a link to the nextDash inbox.

Type ``nd https://example.com/article`` and press Enter. The whole extension is
one GET to /add — see integrations/README.md — so there is nothing to keep in
sync with the app beyond that one route.
"""

import re
import urllib.parse
import urllib.request

from ulauncher.api.client.EventListener import EventListener
from ulauncher.api.client.Extension import Extension
from ulauncher.api.shared.action.ExtensionCustomAction import ExtensionCustomAction
from ulauncher.api.shared.action.HideWindowAction import HideWindowAction
from ulauncher.api.shared.action.RenderResultListAction import RenderResultListAction
from ulauncher.api.shared.event import ItemEnterEvent, KeywordQueryEvent
from ulauncher.api.shared.item.ExtensionResultItem import ExtensionResultItem

# The same rule the server applies: the first http(s) address wins, and trailing
# sentence punctuation belongs to the sentence.
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+")


def first_url(text):
    match = URL_PATTERN.search(text or "")
    if not match:
        return None
    return match.group(0).rstrip(".,;:!?)]}\"'")


class NextDashExtension(Extension):
    def __init__(self):
        super().__init__()
        self.subscribe(KeywordQueryEvent, KeywordQueryEventListener())
        self.subscribe(ItemEnterEvent, ItemEnterEventListener())


class KeywordQueryEventListener(EventListener):
    def on_event(self, event, extension):
        query = (event.get_argument() or "").strip()
        url = first_url(query)

        if not url:
            return RenderResultListAction([
                ExtensionResultItem(
                    icon="images/icon.png",
                    name="Paste a link to save",
                    description="nd https://example.com/article",
                    on_enter=HideWindowAction(),
                )
            ])

        # Whatever is not the address is the title — the same split the share
        # target makes, so a copied "Some title https://…" arrives named.
        title = query.replace(url, "").strip(" -–—:|")
        return RenderResultListAction([
            ExtensionResultItem(
                icon="images/icon.png",
                name="Save to the nextDash inbox",
                description=title or url,
                on_enter=ExtensionCustomAction({"url": url, "title": title}, keep_app_open=False),
            )
        ])


class ItemEnterEventListener(EventListener):
    def on_event(self, event, extension):
        data = event.get_data()
        base = (extension.preferences.get("nd_url") or "http://localhost:8080").rstrip("/")
        params = {"url": data["url"], "title": data.get("title", "")}
        token = (extension.preferences.get("nd_token") or "").strip()
        if token:
            params["token"] = token

        request = urllib.request.Request(f"{base}/add?{urllib.parse.urlencode(params)}")
        try:
            # The answer is a page for a person; an extension only needs to know
            # that it landed, and Ulauncher has nowhere to show more than that.
            urllib.request.urlopen(request, timeout=10).read()
        except Exception:
            # Deliberately quiet: Ulauncher closes on Enter, so there is nowhere
            # to put an error. The link is either in the inbox or it is not, and
            # the inbox is the place to check.
            pass
        return HideWindowAction()


if __name__ == "__main__":
    NextDashExtension().run()
