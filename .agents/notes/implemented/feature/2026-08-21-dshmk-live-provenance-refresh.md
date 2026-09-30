# Agent Note: Refresh DSHMK provenance after cached first paint

Status: implemented

English | [中文](2026-08-21-dshmk-live-provenance-refresh.zh.md)

## Problem

The DSHMK catalog grew beyond the launcher's 16 MiB response limit and the live request was bounded to 16 seconds. The native launcher therefore selected the local snapshot on every HUB launch. Even when a background refresh later succeeded, the page had no notification path and kept rendering the cache provenance badge.

## Decision

The launcher accepts the current DSHMK catalog within a 32 MiB bound and gives the first-party endpoint a bounded four-minute transfer window. The alternate raw catalog keeps a shorter 45-second bound and remains subject to the existing regression guard. Cached data still paints immediately for offline resilience. A successful background refresh posts a small native WebView event; the DSHMK surface re-requests its current page and updates the provenance badge to live without resetting filters, pagination, details, or the native window.

Explicit refresh bypasses the in-memory TTL and sends HTTP Cache-Control revalidation through the same bounded transfer. One pending native task serves concurrent refresh callers. The UI retains usable cards through transfer and failure. Source generation time remains publisher-owned; synchronization time records a successful fetch. Loading a persisted provenance record does not make disk data live. This prevents refresh controls and online badges from promising freshness that no network response established.

Catalog selection prefers source generation time over repository count. A substantially smaller candidate is accepted only when it is newer, retains installation capability, contains at least 100 unique valid GitHub repositories, and its declared fetched count matches its complete repository array. Older snapshots, inconsistent counts and severe capability loss remain rejected. Repository count alone cannot pin a newer curated catalog behind an old larger snapshot. A usable cached catalog receives a localized non-blocking notice with collapsed diagnostics rather than an unavailable-page error.

## Verification

The launcher build must compile the native bridge and the GUI suite must cover the subscription as a no-op outside WebView2. Installed-path validation checks that the updated launcher loads the existing catalog cache, refreshes the live source when reachable, and emits `dsh-hub-catalog-updated` after a successful refresh. Setup EXEs are not rebuilt for this change.

The isolated CatalogRefreshHarness exercises cache bypass, concurrent pending-transfer reuse, offline recovery, and unchanged source generation timestamps. Client tests exercise explicit refresh, visible pending feedback, retained cards after failure, and ordinary filter requests without a sticky force-refresh flag. These checks do not substitute for an installed-path or live-provider test.

The September 29 isolated native regression accepts the complete newer subset and rejects older, inconsistent, duplicate and tiny snapshots; restarting catalog selection retains the newer cache. A real production-bridge refresh in a fresh D: fixture returned 2,500 repositories generated at `2026-09-29T15:34:00.073Z`. Built-client tests cover Chinese and English cached failure, collapsed diagnostics, a single retry control and successful live refresh. These tests do not modify the host installation or user profiles.

## Alternatives considered

**Replace cached-first startup with live-only startup:** rejected because a slow or unavailable DSHMK endpoint would make HUB appear empty or unusable for offline and degraded networks.

**Keep the live refresh silent until the next launch:** rejected because users would continue seeing the stale `本机缓存` provenance badge and would not know that the current catalog had already been refreshed.

## Consequences

The first live DSHMK request may take longer than an ordinary catalog request, but it has a bounded timeout and does not block the cached first paint. A successful refresh causes a small in-place data request on the current page; filters, pagination, details, scroll position, and native window geometry remain owned by the existing HUB state.
