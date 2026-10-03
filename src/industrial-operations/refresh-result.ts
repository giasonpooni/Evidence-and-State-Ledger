/** Read-only reinspection of one exact completed refresh. Never repair, capture or admit. */
import { join } from 'node:path';
import { z } from 'zod';
import { readIndustrialCapture, industrialReviewPolicy } from '../acquisition/industrial-review';
import { parseCaptureSchedule } from '../acquisition/schedule';
import { LocalEvidenceIntake } from '../data-os/local-intake';
import { readImmutableFile } from '../data-os/local-files';
import { byteDigest } from '../data-os/evidence-capture';
import { parseReplayJson } from '../observation/json';
import { check, commitment, hash, id, instant, type AuthorityKey } from './authority';
import { attemptIdSchema, lockPresent, readRefreshHistory } from './refresh-state';
import { REFRESH_OPERATION } from './pipeline';

const SOURCE_LIMIT = 8 * 1024 * 1024;
const VIEW_LIMIT = 2 * 1024 * 1024;
const META_LIMIT = 64 * 1024;
const falseValue = z.literal(false), nil = z.null();
const bindingSchema = z.object({ file: id, sourceId: id, contentDigest: hash,
  byteLength: z.number().int().positive().max(SOURCE_LIMIT), acquisitionId: z.string().min(1).max(240),
  acquisitionDigest: hash, retrievedAt: instant }).strict();
const reviewSchema = z.object({ schema: z.literal('payload.industrial-source-review.v1'), audience: z.literal('INTERNAL'),
  captureManifestDigest: hash, bindings: z.array(bindingSchema).length(5), inspectedAt: instant,
  integrity: z.literal('RECOMPUTED_LOCAL'), policyAuthority: z.literal('OPERATOR_DECLARATION'),
  canonicalAdmission: falseValue, release: nil, customerDistributionPermitted: falseValue,
  sourceTruthClaimed: falseValue, independentVerification: falseValue, digest: hash }).strict();
const indexSchema = z.object({ schema: z.literal('gsc.industrial-review-index.v1'), audience: z.literal('INTERNAL'),
  file: z.string().regex(/^review-[a-f0-9]{64}\.json$/), sha256: hash,
  bytes: z.number().int().positive().max(VIEW_LIMIT), canonicalAdmission: falseValue, release: nil }).strict();
const scalar = z.number().finite();
const sampleSchema = z.object({ time: instant, valueM: scalar.min(-100).max(100).nullable(),
  sigmaM: scalar.min(0).max(100).nullable(), quality: z.enum(['preliminary', 'verified']),
  flags: z.string().regex(/^\d+,[01],[01],[01]$/), firstFlagRole: z.enum(['outlier_count', 'inferred']) }).strict();
const viewSchema = z.object({ schema: z.literal('gsc.industrial-review.v1'), audience: z.literal('INTERNAL'),
  status: z.literal('UNADMITTED_SOURCE_REVIEW'), canonicalAdmission: falseValue, release: nil,
  compiledAt: instant, captureManifestDigest: hash, esmReviewDigest: hash,
  operation: z.literal('gsc.industrial-source-review.compile.v1'), executionId: z.string().regex(/^execution:[a-z0-9-]{1,80}$/),
  verification: z.literal('LOCAL_HASH_BINDINGS_ONLY'),
  sources: z.array(z.object({ file: id, sourceId: id, digest: hash, retrievedAt: instant, acquisitionDigest: hash }).strict()).length(5),
  station: z.object({ id: z.literal('9414290'), name: z.literal('San Francisco'), latitude: scalar.min(-90).max(90),
    longitude: scalar.min(-180).max(180), horizontalDatum: z.literal('not-declared-by-response'), markerAltitudeM: nil }).strict(),
  water: z.object({ unit: z.literal('m'), verticalDatum: z.literal('NAVD88'), sourcePublishedAt: nil, retrievedAt: instant,
    samples: z.array(sampleSchema).max(2048), expectedCadenceMs: z.literal(360000), staleAfterMs: z.literal(1080000),
    sigmaMeaning: z.literal('standard-deviation-of-1-second-samples'), latestObservedAt: instant.nullable() }).strict(),
  terrain: z.object({ width: z.literal(129), height: z.literal(129), affine: z.array(scalar).length(6), bounds: z.array(scalar).length(4),
    horizontalCrs: z.literal('EPSG:4269'), verticalDatum: z.literal('NAVD88'), unit: z.literal('m'),
    heights: z.array(scalar.min(-500).max(9000).nullable()).length(16641), pixelInterpretation: z.literal('area-center'),
    resampling: z.literal('provider-nearest'), surveyedAt: nil, retrievedAt: instant, rawArtifactDigest: hash,
    gridDigest: hash, minimumM: scalar, maximumM: scalar, missingCells: z.number().int().min(0).max(16641) }).strict(),
  nonclaims: z.object({ sourceAuthenticated: falseValue, independentVerification: falseValue,
    datumTransformation: falseValue, floodModel: falseValue, navigation: falseValue, releaseAuthorization: falseValue }).strict(),
}).strict();

/** Trusted server configuration only; never accepted from an HTTP query or scene file. */
export const retainedReviewRequestSchema = z.object({ schema: z.literal('payload.retained-review-selection.v1'),
  refreshRoot: z.string().min(1).max(2048), intakeRoot: z.string().min(1).max(2048),
  schedule: z.unknown().refine(s => { try { parseCaptureSchedule(s); return true; } catch { return false; } }),
  attemptId: attemptIdSchema, compiledDigest: hash }).strict();
export interface ResultInspectionOptions {
  root: string; intakeRoot: string; schedule: unknown; attemptId: string; at: string;
  authorityKeys?: readonly AuthorityKey[];
}
function jsonAt(root: string, parts: string[], max: number) {
  const bytes = readImmutableFile(root, parts, max);
  check(bytes, 'RESULT_FILE_UNAVAILABLE');
  return { bytes, value: parseReplayJson(bytes, max) };
}
function object(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'RESULT_BINDING_MISMATCH');
  return value as Record<string, unknown>;
}
function same(a: unknown, b: unknown): boolean { return commitment(a) === commitment(b); }
function decimal(value: unknown, lo: number, hi: number): number | null {
  if (value === '' || value === null) return null;
  check(typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value), 'OBSERVATION_BINDING_MISMATCH');
  const n = Number(value);
  check(Number.isFinite(n) && n >= lo && n <= hi, 'OBSERVATION_BINDING_MISMATCH');
  return n;
}
function ordered(...times: string[]) {
  times.forEach(t => instant.parse(t));
  check(times.every((t, i) => i === 0 || Date.parse(times[i - 1]) <= Date.parse(t)), 'RESULT_CLOCK_MISMATCH');
}

/** Reopen exact retained bytes and direct field bindings. This is not a TIFF decoder or compiler execution. */
export function reinspectRefreshResult(options: ResultInspectionOptions) {
  instant.parse(options.at); attemptIdSchema.parse(options.attemptId);
  const readOptions = { ...options, operation: REFRESH_OPERATION };
  const schedule = parseCaptureSchedule(options.schedule);
  check(!lockPresent(options.root, schedule.scheduleId), 'REFRESH_LOCKED');
  const history = readRefreshHistory(readOptions);
  check(history.initialized, 'REFRESH_UNINITIALIZED');
  const slot = history.slots.find(s => s.attemptId === options.attemptId);
  check(slot, 'ATTEMPT_NOT_FOUND');
  check(slot.receipt?.state === 'CAPTURED' && slot.receipt.result && !slot.quarantine, 'ATTEMPT_NOT_CAPTURED');
  const expected = slot.receipt.result;
  const attempt = join(history.control, 'attempts', slot.attemptId);
  const capture = readIndustrialCapture(join(attempt, 'capture'), options.at);
  check(capture.captureManifestDigest === expected.captureDigest, 'CAPTURE_RESULT_MISMATCH');
  const sourceBytes = capture.pending.reduce((n, p) => n + p.bytes.length, 0);
  check(sourceBytes <= 5 * SOURCE_LIMIT, 'RESULT_SIZE_LIMIT');
  const review = reviewSchema.parse(jsonAt(attempt, ['esm-review.json'], META_LIMIT).value);
  const { digest: reviewDigest, ...reviewBody } = review;
  check(commitment(reviewBody) === reviewDigest && reviewDigest === expected.reviewDigest &&
    review.captureManifestDigest === expected.captureDigest, 'REVIEW_RESULT_MISMATCH');
  const index = indexSchema.parse(jsonAt(attempt, ['view', 'index.json'], 4096).value);
  check(index.sha256 === expected.compiledDigest && index.file === `review-${expected.compiledDigest.slice(7)}.json`, 'COMPILED_RESULT_MISMATCH');
  const compiled = jsonAt(attempt, ['view', index.file], VIEW_LIMIT);
  check(byteDigest(compiled.bytes) === expected.compiledDigest && compiled.bytes.length === index.bytes, 'COMPILED_RESULT_MISMATCH');
  const view = viewSchema.parse(compiled.value);
  check(view.captureManifestDigest === expected.captureDigest && view.esmReviewDigest === expected.reviewDigest, 'COMPILED_RESULT_MISMATCH');
  ordered(slot.intent.startedAt, capture.capturedAt, review.inspectedAt, view.compiledAt, slot.receipt.finishedAt, options.at);
  const manifest = object(jsonAt(attempt, ['capture', 'capture.json'], SOURCE_LIMIT).value);
  check(Array.isArray(manifest.artifacts) && manifest.artifacts.length === 4, 'RESULT_BINDING_MISMATCH');
  const intake = new LocalEvidenceIntake(options.intakeRoot);
  for (let i = 0; i < capture.pending.length; i++) {
    const p = capture.pending[i], b = review.bindings[i], source = view.sources[i];
    const digest = byteDigest(p.bytes), acquisitionId = `industrial:${expected.captureDigest.slice(7)}:${p.file}`;
    check(b.file === p.file && b.sourceId === p.sourceId && b.contentDigest === digest && b.byteLength === p.bytes.length &&
      b.acquisitionId === acquisitionId && b.retrievedAt === p.retrievedAt, 'ACQUISITION_BINDING_MISMATCH');
    check(same(source, { file: p.file, sourceId: p.sourceId, digest, retrievedAt: p.retrievedAt,
      acquisitionDigest: b.acquisitionDigest }), 'COMPILED_SOURCE_MISMATCH');
    ordered(slot.intent.startedAt, p.retrievedAt, capture.capturedAt);
    if (i < 4) {
      const a = object(manifest.artifacts[i]);
      check(a.sourcePublishedAt === null && typeof a.requestedAt === 'string', 'SOURCE_CLOCK_UNSUPPORTED');
      ordered(slot.intent.startedAt, a.requestedAt, p.retrievedAt);
    }
    // Preserve native intake semantics, and check the actual bytes rather than the report's own label.
    const acquisition = intake.inspect(acquisitionId);
    check(acquisition && acquisition.digest === b.acquisitionDigest && acquisition.request.contentDigest === digest &&
      acquisition.request.byteLength === p.bytes.length, 'ACQUISITION_BINDING_MISMATCH');
    const declaration = acquisition.request.manifest;
    check(declaration.acquisitionId === acquisitionId && declaration.capturedAt === p.retrievedAt &&
      declaration.evidenceId === `evidence:${acquisitionId}` && declaration.purpose === 'industrial-source-qualification' &&
      declaration.mediaType === (p.file.endsWith('.tif') ? 'image/tiff' : 'application/json') &&
      same(declaration.sourceRegistration, industrialReviewPolicy(p.sourceId)), 'ACQUISITION_BINDING_MISMATCH');
    ordered(declaration.capturedAt, acquisition.capture.receipt.storedAt, review.inspectedAt);
  }
  const sourceJSON = (index: number) => object(parseReplayJson(capture.pending[index].bytes, SOURCE_LIMIT));
  const stationDoc = sourceJSON(0), feed = sourceJSON(1), grid = sourceJSON(4);
  check(Array.isArray(stationDoc.stations) && stationDoc.stations.length === 1, 'STATION_BINDING_MISMATCH');
  const station = object(stationDoc.stations[0]);
  check(station.id === view.station.id && station.name === view.station.name &&
    station.lat === view.station.latitude && station.lng === view.station.longitude, 'STATION_BINDING_MISMATCH');
  check(object(feed.metadata).id === view.station.id && !feed.error && Array.isArray(feed.data) &&
    feed.data.length === view.water.samples.length, 'OBSERVATION_BINDING_MISMATCH');
  check(view.water.retrievedAt === capture.pending[1].retrievedAt, 'RESULT_CLOCK_MISMATCH');
  let prior = -Infinity, latestNumericAt: string | null = null, numericCount = 0;
  for (let i = 0; i < view.water.samples.length; i++) {
    const raw = object(feed.data[i]), sample = view.water.samples[i];
    check(Object.keys(raw).length === 5 && ['t','v','s','f','q'].every(k => Object.hasOwn(raw, k)) &&
      typeof raw.t === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw.t), 'OBSERVATION_BINDING_MISMATCH');
    const time = raw.t.replace(' ', 'T') + ':00.000Z'; instant.parse(time);
    check(sample.time === time && Date.parse(time) > prior && Date.parse(time) <= Date.parse(view.water.retrievedAt), 'OBSERVATION_CLOCK_MISMATCH');
    prior = Date.parse(time);
    check((raw.q === 'p' || raw.q === 'v') && sample.flags === raw.f &&
      sample.quality === (raw.q === 'p' ? 'preliminary' : 'verified') &&
      sample.firstFlagRole === (raw.q === 'p' ? 'outlier_count' : 'inferred') &&
      Number.isSafeInteger(Number(sample.flags.split(',')[0])) &&
      (raw.q === 'p' || Number(sample.flags.split(',')[0]) <= 1) &&
      sample.valueM === decimal(raw.v, -100, 100) && sample.sigmaM === decimal(raw.s, 0, 100), 'OBSERVATION_BINDING_MISMATCH');
    if (sample.valueM !== null) { latestNumericAt = sample.time; numericCount++; }
  }
  const latestRowAt = view.water.samples.at(-1)?.time ?? null;
  check(latestRowAt === view.water.latestObservedAt, 'OBSERVATION_CLOCK_MISMATCH');
  check(grid.schema === 'gsc.terrain-grid.v1' && grid.sourceArtifact === view.terrain.rawArtifactDigest &&
    view.terrain.rawArtifactDigest === byteDigest(capture.pending[3].bytes) &&
    view.terrain.gridDigest === byteDigest(capture.pending[4].bytes) && grid.units === view.terrain.unit &&
    grid.rowOrder === 'north-to-south' && grid.axisOrder === 'longitude-latitude' &&
    view.terrain.retrievedAt === capture.pending[3].retrievedAt, 'TERRAIN_BINDING_MISMATCH');
  for (const field of ['width','height','affine','bounds','horizontalCrs','verticalDatum','heights',
    'pixelInterpretation','resampling','surveyedAt','minimumM','maximumM','missingCells'] as const) {
    check(same(grid[field], view.terrain[field]), 'TERRAIN_BINDING_MISMATCH');
  }
  // An unchanged journal cannot vouch for a changed capture selection: compare it as well.
  const confirmManifest = jsonAt(attempt, ['capture','capture.json'], SOURCE_LIMIT).bytes;
  check(byteDigest(confirmManifest) === expected.captureDigest, 'CAPTURE_RESULT_MISMATCH');
  const confirm = readRefreshHistory(readOptions);
  check(!lockPresent(options.root, schedule.scheduleId), 'REFRESH_LOCKED');
  check(confirm.historyDigest === history.historyDigest, 'HISTORY_CHANGED_DURING_READ');
  const observationAgeMs = latestNumericAt === null ? null : Date.parse(options.at) - Date.parse(latestNumericAt);
  const freshness = observationAgeMs === null ? 'NO_NUMERIC_OBSERVATIONS' as const :
    observationAgeMs > view.water.staleAfterMs ? 'STALE' as const : 'FRESH' as const;
  const body = {
    schema: 'payload.industrial-retained-result-inspection.v1' as const,
    status: 'REINSPECTED' as const, verificationScope: 'RETAINED_BYTES_AND_DIRECT_BINDINGS' as const,
    algorithm: 'esm.industrial-retained-result.inspect.v1' as const, assessedAt: options.at,
    scheduleId: schedule.scheduleId, attemptId: slot.attemptId, historyDigest: history.historyDigest,
    receiptDigest: slot.receipt.digest, result: expected,
    checked: { acquisitionCount: review.bindings.length, sourceBytes, compiledBytes: compiled.bytes.length,
      sourceDigests: review.bindings.map(b => ({file:b.file, contentDigest:b.contentDigest, acquisitionDigest:b.acquisitionDigest})) },
    clocks: { captureCompletedAt: capture.capturedAt, esmInspectedAt: review.inspectedAt, compiledAt: view.compiledAt,
      journalFinishedAt: slot.receipt.finishedAt, waterRetrievedAt: view.water.retrievedAt,
      terrainRetrievedAt: view.terrain.retrievedAt, sourcePublishedAt: null, terrainSurveyedAt: null },
    observations: { rowCount:view.water.samples.length, numericCount, missingValueCount:view.water.samples.length-numericCount,
      latestRowAt, latestNumericAt },
    freshness: { state:freshness, basis:'LATEST_NUMERIC_OBSERVATION' as const,
      policy:'GSC_DISPLAY_THRESHOLD_NOT_PROVIDER_SLA' as const, staleAfterMs:view.water.staleAfterMs,
      observationAgeMs, retrievalAgeMs:Date.parse(options.at)-Date.parse(view.water.retrievedAt),
      journalAgeMs:Date.parse(options.at)-Date.parse(slot.receipt.finishedAt),
      publicationAgeMs:null, terrainSurveyAgeMs:null },
    sourceAuthenticated:false, rasterDecodePerformed:false, compilerExecuted:false,
    measurementAccuracyVerified:false, executionAuthorized:false, sourceFetchPerformed:false,
    canonicalAdmission:false, release:null,
  };
  return { report: { ...body, digest:commitment(body) }, compiledBytes:compiled.bytes };
}

/** Public CLI result contains no bytes, host paths, raw errors or partial success. */
export function inspectRefreshResult(options: ResultInspectionOptions) {
  try { return reinspectRefreshResult(options).report; }
  catch (error) {
    const codes = new Set(['REFRESH_LOCKED','REFRESH_UNINITIALIZED','ATTEMPT_NOT_FOUND','ATTEMPT_NOT_CAPTURED',
      'RESULT_FILE_UNAVAILABLE','RESULT_SIZE_LIMIT','CAPTURE_RESULT_MISMATCH','REVIEW_RESULT_MISMATCH',
      'COMPILED_RESULT_MISMATCH','RESULT_CLOCK_MISMATCH','SOURCE_CLOCK_UNSUPPORTED','ACQUISITION_BINDING_MISMATCH',
      'COMPILED_SOURCE_MISMATCH','STATION_BINDING_MISMATCH','OBSERVATION_BINDING_MISMATCH',
      'OBSERVATION_CLOCK_MISMATCH','TERRAIN_BINDING_MISMATCH','HISTORY_CHANGED_DURING_READ',
      'SOURCE_BYTES_MISMATCH','DERIVED_BINDING_MISMATCH','DERIVED_LINEAGE_MISMATCH',
      'HISTORY_BINDING_MISMATCH','RECEIPT_HASH_MISMATCH','RECEIPT_BINDING_MISMATCH','CONFLICTING_TERMINAL_RECORDS']);
    return { schema:'payload.industrial-retained-result-inspection.v1' as const, status:'UNAVAILABLE' as const,
      reasonCode:error instanceof Error && codes.has(error.message) ? error.message : 'INVALID_RETAINED_RESULT',
      verificationScope:'RETAINED_BYTES_AND_DIRECT_BINDINGS' as const, result:null, freshness:null,
      sourceFetchPerformed:false, executionAuthorized:false, canonicalAdmission:false, release:null };
  }
}
