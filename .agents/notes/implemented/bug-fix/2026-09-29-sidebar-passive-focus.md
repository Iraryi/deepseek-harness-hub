# Agent Note: Distinguish passive brand focus from keyboard navigation

Status: implemented

English | [中文](2026-09-29-sidebar-passive-focus.zh.md)

## Problem

The reported startup brand ring disappears after interaction, making passive focus or selection a stronger hypothesis than the static version-badge background. The brand is the first sidebar button; styling `:focus-visible` alone does not distinguish a host assigning startup focus from deliberate keyboard navigation. The original installed-app artifact has not been reproduced in an isolated native window.

## Decision

The sidebar tracks document keyboard-navigation and pointer events locally, with listeners removed on unmount. Its brand outline requires both keyboard navigation and `:focus-visible`; passive focus retains its functional target without an outline. Brand descendants disallow text selection and native dragging, and the brand cancels drag-start events from contributed artwork. The policy never blurs controls, clears document selections, changes tab order or prevents events elsewhere.

## Alternatives considered

Removing every focus outline or disabling selection on the whole application would damage keyboard navigation and conversation copying. Forcibly moving startup focus would change the user's active control. Neither is necessary for the brand-only issue.

## Consequences

Keyboard Tab, arrows, Enter and Space enable the brand focus cue; pointer input dismisses it. Brand text is not copyable by dragging. This narrow behavior change addresses both suspected mechanisms, but does not prove the precise cause of the reported native startup artifact.

## Verification

Component tests cover passive focus, keyboard and pointer transitions, preserved activation, drag cancellation scope and listener cleanup. Style tests constrain selection suppression and the keyboard-only outline. Assembled-client tests exercise the same interaction with both Chinese and English UI. These checks do not replace confirmation on the affected installed application.
