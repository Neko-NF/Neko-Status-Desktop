# Neko Status Desktop agent workflow

## Open diagnostics issue check

Before starting a feature, bug fix, release plan or version upgrade, query the deployed `neko-server` on that server's local disk:

```text
npm run diagnostics:issues -- list
```

Record issue IDs included in the work, deferred with a reason, and unrelated. If the deployment server is unavailable, explicitly record that the open-issue check is incomplete; never infer that there are no issues. A related open issue must be added to implementation and regression tests. Mark it resolved with `resolve --fixed-in <version>` only after deployment and regression verification succeed.

## Diagnostics contribution gate

Every new feature source covered by `scripts/verify-diagnostics-contract.js` must be declared in `docs/feature-diagnostics-manifest.json` as a versioned contribution or `diagnostics: none` with a reason. Registry changes require a schema version bump, the authoritative `docs/diagnostics-improvement-program.md`, the golden schema, tests and release notes. Any currently prohibited data category requires a consent policy version bump and user reconfirmation.
