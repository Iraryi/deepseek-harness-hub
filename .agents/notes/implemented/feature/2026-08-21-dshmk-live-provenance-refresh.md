# Agent Note: Refresh DSHMK provenance after cached first paint

Status: implemented

English | [中文](2026-08-21-dshmk-live-provenance-refresh.zh.md)

## Problem

The DSHMK catalog grew beyond the launcher's 16 MiB response limit and the live request was bounded to 16 seconds. The native launcher therefore selected the local snapshot on every HUB launch. Even when a background refresh later succeeded, the page had no notification path and kept rendering the cache provenance badge.

## Decision

The launcher accepts the current DSHMK catalog within a 32 MiB bound and gives the first-party endpoint a bounded four-minute transfer window. The alternate raw catalog keeps a shorter 45-second bound and remains subject to the existing regression guard. Cached data still paints immediately for offline resilience. A successful background refresh posts a small native WebView event; the DSHMK surface re-requests its current page and updates the provenance badge to live without resetting filters, pagination, details, or the native window.

## Verification

The launcher build must compile the native bridge and the GUI suite must cover the subscription as a no-op outside WebView2. Installed-path validation checks that the updated launcher loads the existing catalog cache, refreshes the live source when reachable, and emits `dsh-hub-catalog-updated` after a successful refresh. Setup EXEs are not rebuilt for this change.

## Alternatives considered

**Replace cached-first startup with live-only startup:** rejected because a slow or unavailable DSHMK endpoint would make HUB appear empty or unusable for offline and degraded networks.

**Keep the live refresh silent until the next launch:** rejected because users would continue seeing the stale `本机缓存` provenance badge and would not know that the current catalog had already been refreshed.

## Consequences

The first live DSHMK request may take longer than an ordinary catalog request, but it has a bounded timeout and does not block the cached first paint. A successful refresh causes a small in-place data request on the current page; filters, pagination, details, scroll position, and native window geometry remain owned by the existing HUB state.
