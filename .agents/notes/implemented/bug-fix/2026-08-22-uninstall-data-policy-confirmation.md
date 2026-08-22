# Agent Note: Uninstall data policy is separate from confirmation

Status: implemented

[中文](2026-08-22-uninstall-data-policy-confirmation.zh.md) | English

## Problem

The uninstaller used one Yes/No question to decide both whether to uninstall and whether to delete user data. Users commonly interpret No as leaving the operation, so the data-preservation choice was too easy to misunderstand.

## Decision

`windows/setup/DeepSeekHarness.iss` now opens a dedicated custom uninstall dialog. The dialog presents two radio options for the data policy, defaults to keeping user data, and uses separate Yes and No buttons for the uninstall decision. Selecting No returns from `InitializeUninstall` and cancels the uninstall before product files or user data are removed. Selecting Yes proceeds and `CurUninstallStepChanged` deletes the standard and portable data roots only when the delete-data radio option was selected.

The data policy is intentionally concise in the radio labels so it remains readable at the Setup window's scaled dimensions. The explanatory text identifies the policy as independent from the final uninstall confirmation.

## Alternatives considered

**Keep the Yes/No message box and invert the labels.** Rejected because a binary message box still conflates the destructive data choice with the uninstall decision and remains easy to misread.

**Add a third “keep data” button to the message box.** Rejected because the data policy is a persistent choice and should remain visibly selected before the final confirmation.

## Consequences

Normal uninstall keeps settings, sessions, logs, plugin data, and portable data without requiring an additional decision. Users who intentionally select delete-data receive the same cleanup behavior as before, but only after confirming the uninstall with Yes. The custom dialog must be compiled and visually checked with both bundled languages and the configured DPI; an Inno Setup compiler is required for that final check.

## Testing

Static checks verify that the script has separate data-policy controls, defaults the keep-data option, maps Yes to `mrOk`, maps No to `mrCancel`, and gates cleanup on `DeleteUserDataRequested`. Inno Setup 6.7.3 compiled both Full and Lite Setup executables successfully from the updated script.
