# Industrial viewer recheck qualification

This increment adds qualification only: the original admission, release, source
intake, refresh and distribution implementations are unchanged. It binds the
existing authenticated distribution server to GSV's recheckable industrial UI.

## Public-safe fixture mode

The evidence repository is now named Evidence-and-State-Ledger and is public.
The new workflow therefore uses only freshly generated synthetic wire-contract
fixtures, never internal retained captures or live NOAA/USGS requests. The
existing live qualification job now requires a private repository. That guard
applies to revisions containing it; it is not a claim to remove artifacts or
change workflow definitions on other existing branches.

The synthetic fixture is derived from the already tested retained-result test
factory. It executes the original refresh journal and LocalEvidenceIntake using
an explicitly supplied synthetic execution adapter. Its TIFF member is a text
marker, not a decoded raster, and its elevation grid and water measurements are
constructed test values. Fixed source identifiers and LIVE_CAPTURE wire fields
exist only to exercise the unchanged production schema; they are not assertions
of real acquisition. Fixture setup disables fetch and invokes no acquisition
pipeline, raster decoder, compiler, admission or release writer.

The workflow's real HTTP server, authentication, dependency inspection and
Chromium viewer are not mocks. The browser adds a SYNTHETIC CONTRACT FIXTURE
annotation to its screenshot's authority heading; this is a test presentation
annotation, not a new production mode or a change to admission semantics.
The fixture's server-side inspection label covers retained bytes and direct
bindings only, and does not validate the originally asserted acquisition class.

## Exercised behavior

The browser drives the actual Recheck retained capture button. A successful
request retains the exact artifact digest, camera, selected sample and wireframe
state. Verification details name the latest numeric observation and distinguish
server assertions from browser-clock arithmetic. A scratch source corruption
causes the next HTTP read to return 503; the UI suppresses prior data, sampling
and geometry. Restoring the original configured selection permits an explicit
retry of the same artifact, not replacement acquisition. Revoking credentials
returns 401 on the next request and the UI hides old data after explicit recheck.

Expected 401/503 browser resource errors are retained separately and asserted by
exact selected URL and count. Unexpected errors and outbound viewer requests
still fail the test. No failing test is waived. The complete existing scoped ESM
suite and architecture checks run alongside the viewer's full test/build checks.

## Artifact boundary

The new public artifact contains only fixture-mode declaration, test reports,
browser reports/screenshots, exact component pins and checksums. No source or
intake store, access configuration, bearer token, private signing key, or
internal-only live capture is uploaded. Temporary fixture stores are confined
to the disposable CI runner. The previous live qualification script remains
available for an explicitly authorized private execution environment.

Synthetic end-to-end success qualifies the software path; it does not establish
fresh live acquisition, real source rights/admission/release, continuous access,
production credentials, an active collector or measurement/geodetic accuracy.
The ordinary GSV default/synthetic scene and prior industrial contracts remain
unchanged. No repository visibility change, merge or deployment is performed by
this change. Current results must be taken from the exact recorded CI run.
