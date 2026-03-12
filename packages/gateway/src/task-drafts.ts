import {
	createTaughtTaskDraft,
	createTaughtTaskDraftFromVideo,
	lintTaughtTaskDraft,
	listTaughtTaskDrafts,
	loadTaughtTaskDraft,
	persistTaughtTaskDraft,
	publishTaughtTaskDraft,
	resolveUnderstudyHomeDir,
	updateTaughtTaskDraft,
	type TaughtTaskDraft,
} from "@understudy/core";
import {
	buildTeachCapabilitySnapshot,
	createSessionVideoTeachAnalyzer,
	type DemonstrationEvent,
	type DemonstrationEvidenceFrame,
	type VideoTeachAnalyzer,
} from "@understudy/tools";
import type { UnderstudyConfig } from "@understudy/types";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve as resolvePath } from "node:path";
import type { SessionEntry, SessionRunTrace } from "./session-runtime.js";
import { asBoolean, asNumber, asRecord, asString, sanitizePathSegment } from "./value-coerce.js";

const DEFAULT_MAX_MATERIALIZED_VIDEO_BYTES = 32 * 1024 * 1024;

function resolveVideoTeachArtifactDir(entry: SessionEntry, sourceLabel: string): string {
	const workspaceKey = createHash("sha1")
		.update(resolvePath(entry.workspaceDir ?? "workspace"))
		.digest("hex")
		.slice(0, 12);
	return join(
		resolveUnderstudyHomeDir(),
		"learning",
		"teach-artifacts",
		workspaceKey,
		sanitizePathSegment(entry.id, "session"),
		`${Date.now()}-${sanitizePathSegment(sourceLabel, "demo")}`,
	);
}

function normalizeEvidenceKeyframes(value: DemonstrationEvidenceFrame[] | undefined): Array<Record<string, unknown>> | undefined {
	if (!Array.isArray(value) || value.length === 0) {
		return undefined;
	}
	return value.map((frame) => ({
		path: frame.path,
		mimeType: frame.mimeType,
		timestampMs: frame.timestampMs,
		label: frame.label,
		kind: frame.kind,
		episodeId: frame.episodeId,
	}));
}

export interface CreateGatewayTaskDraftHandlersOptions {
	sessionEntries: Map<string, SessionEntry>;
	resolveDefaultWorkspaceDir?: () => string | undefined;
	videoTeachAnalyzer?: VideoTeachAnalyzer;
	config?: UnderstudyConfig;
}

export interface GatewayTaskDraftHandlers {
	list(params?: Record<string, unknown>): Promise<{ workspaceDir?: string; drafts: TaughtTaskDraft[] }>;
	get(params?: Record<string, unknown>): Promise<TaughtTaskDraft | null>;
	create(params?: Record<string, unknown>): Promise<{ draft: TaughtTaskDraft; created: boolean }>;
	createFromVideo(params?: Record<string, unknown>): Promise<{ draft: TaughtTaskDraft; created: boolean }>;
	update(params?: Record<string, unknown>): Promise<TaughtTaskDraft>;
	publish(params?: Record<string, unknown>): Promise<Awaited<ReturnType<typeof publishTaughtTaskDraft>>>;
}

function resolveDefaultVideoTeachAnalyzer(
	options: CreateGatewayTaskDraftHandlersOptions,
): VideoTeachAnalyzer {
	return createSessionVideoTeachAnalyzer({
		config: options.config,
		cwd: options.resolveDefaultWorkspaceDir?.(),
	});
}

function resolveSessionEntry(
	sessionEntries: Map<string, SessionEntry>,
	params?: Record<string, unknown>,
): SessionEntry | undefined {
	const sessionId = asString(params?.sessionId);
	if (!sessionId) {
		return undefined;
	}
	return sessionEntries.get(sessionId);
}

function resolveWorkspaceDir(
	options: CreateGatewayTaskDraftHandlersOptions,
	params?: Record<string, unknown>,
): string | undefined {
	const fromParams = asString(params?.workspaceDir);
	if (fromParams) {
		return fromParams;
	}
	const entry = resolveSessionEntry(options.sessionEntries, params);
	if (entry?.workspaceDir) {
		return entry.workspaceDir;
	}
	return options.resolveDefaultWorkspaceDir?.();
}

function resolveRun(entry: SessionEntry, params?: Record<string, unknown>): SessionRunTrace | undefined {
	const requestedRunId = asString(params?.runId);
	const runs = Array.isArray(entry.recentRuns) ? entry.recentRuns : [];
	if (!requestedRunId) {
		return runs[0];
	}
	return runs.find((run) => run.runId === requestedRunId);
}

function resolveRunForDraft(
	options: CreateGatewayTaskDraftHandlersOptions,
	draft: TaughtTaskDraft,
	params?: Record<string, unknown>,
): SessionRunTrace | undefined {
	const sessionId = asString(params?.sessionId) ?? draft.sessionId;
	if (!sessionId) {
		return undefined;
	}
	const entry = options.sessionEntries.get(sessionId);
	if (!entry) {
		return undefined;
	}
	const requestedRunId = asString(params?.runId) ?? draft.sourceRunId ?? draft.runId;
	const runs = Array.isArray(entry.recentRuns) ? entry.recentRuns : [];
	if (!requestedRunId) {
		return runs[0];
	}
	return runs.find((run) => run.runId === requestedRunId);
}

function buildStructuralValidationReport(draft: TaughtTaskDraft): {
	ok: boolean;
	summary: string;
} {
	const lintIssues = lintTaughtTaskDraft(draft);
	const ok =
		draft.steps.length > 0 &&
		draft.successCriteria.length > 0 &&
		draft.objective.trim().length > 0 &&
		draft.parameterSlots.every((slot) => slot.required !== true || Boolean(slot.sampleValue?.trim())) &&
		lintIssues.length === 0;
		return {
			ok,
		summary: ok
			? "Validated teach-draft structure for publish."
			: "Draft structure is incomplete and cannot be published yet.",
	};
}

async function ensureDraftValidated(
	options: CreateGatewayTaskDraftHandlersOptions,
	draft: TaughtTaskDraft,
	params?: Record<string, unknown>,
): Promise<TaughtTaskDraft> {
	if (draft.status === "published") {
		return draft;
	}
	const run = resolveRunForDraft(options, draft, params);
	const runValidationState = asString(
		asRecord((run as { teachValidation?: unknown } | undefined)?.teachValidation)?.state,
	);
	if (runValidationState === "failed") {
		throw new Error("The source run is marked as failed and cannot be published.");
	}
	const structuralReport = buildStructuralValidationReport(draft);
	if (!structuralReport.ok) {
		throw new Error(structuralReport.summary);
	}
	return draft;
}

function extensionForMimeType(mimeType?: string): string {
	switch ((mimeType ?? "").toLowerCase()) {
		case "video/quicktime":
			return ".mov";
		case "video/webm":
			return ".webm";
		case "video/x-matroska":
			return ".mkv";
		default:
			return ".mp4";
	}
}

function decodeDataUrl(value: string): { mimeType?: string; bytes: Buffer } {
	const match = value.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);
	if (!match) {
		throw new Error("videoDataUrl must be a base64 data URL");
	}
	return {
		mimeType: asString(match[1]),
		bytes: Buffer.from(match[2], "base64"),
	};
}

function resolveMaxMaterializedVideoBytes(): number {
	const configured = asNumber(process.env.UNDERSTUDY_TEACH_VIDEO_MAX_BYTES);
	if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
		return Math.floor(configured);
	}
	return DEFAULT_MAX_MATERIALIZED_VIDEO_BYTES;
}

function assertMaxVideoBytes(byteLength: number, limit: number, label: string): void {
	if (byteLength <= limit) {
		return;
	}
	const limitMb = Math.max(1, Math.round(limit / (1024 * 1024)));
	throw new Error(`${label} exceeds the ${limitMb} MB materialized upload limit.`);
}

function isVideoTeachCreateRequest(params?: Record<string, unknown>): boolean {
	const sourceKind = asString(params?.sourceKind)?.toLowerCase();
	return sourceKind === "video" ||
		Boolean(asString(params?.videoPath) || asString(params?.videoUrl) || asString(params?.videoDataUrl));
}

async function materializeVideoSource(params: {
	videoPath?: string;
	videoUrl?: string;
	videoDataUrl?: string;
	videoName?: string;
}): Promise<{ videoPath: string; sourceLabel: string; auditSource: string; cleanup?: () => Promise<void> }> {
	const videoPath = asString(params.videoPath);
	if (videoPath) {
		return {
			videoPath: resolvePath(videoPath),
			sourceLabel: asString(params.videoName) ?? basename(videoPath),
			auditSource: resolvePath(videoPath),
		};
	}
	const videoUrl = asString(params.videoUrl);
	const videoDataUrl = asString(params.videoDataUrl);
	if (!videoUrl && !videoDataUrl) {
		throw new Error("videoPath, videoUrl, or videoDataUrl is required");
	}
	const tempDir = await mkdtemp(join(tmpdir(), "understudy-teach-video-source-"));
	try {
		let bytes: Buffer;
		let mimeType: string | undefined;
		let sourceLabel: string;
		const maxBytes = resolveMaxMaterializedVideoBytes();
		if (videoDataUrl) {
			const decoded = decodeDataUrl(videoDataUrl);
			bytes = decoded.bytes;
			mimeType = decoded.mimeType;
			sourceLabel = asString(params.videoName) ?? `demo${extensionForMimeType(mimeType)}`;
			assertMaxVideoBytes(bytes.byteLength, maxBytes, "Demo video");
		} else {
			const response = await fetch(videoUrl!);
			if (!response.ok) {
				throw new Error(`Failed to fetch demonstration video: HTTP ${response.status}`);
			}
			const contentLengthHeader = response.headers.get("content-length");
			if (contentLengthHeader) {
				const contentLength = Number.parseInt(contentLengthHeader, 10);
				if (Number.isFinite(contentLength) && contentLength > 0) {
					assertMaxVideoBytes(contentLength, maxBytes, "Remote demonstration video");
				}
			}
			bytes = Buffer.from(await response.arrayBuffer());
			mimeType = asString(response.headers.get("content-type"));
			sourceLabel = asString(params.videoName) ?? basename(videoUrl!);
			assertMaxVideoBytes(bytes.byteLength, maxBytes, "Remote demonstration video");
		}
		const normalizedLabel = sourceLabel.replace(/[^a-zA-Z0-9._-]+/g, "-") || `demo${extensionForMimeType(mimeType)}`;
		const hasExtension = extname(normalizedLabel).length > 0;
		const fileName = hasExtension ? normalizedLabel : `${normalizedLabel}${extensionForMimeType(mimeType)}`;
		const targetPath = join(tempDir, fileName);
		await writeFile(targetPath, bytes);
		return {
			videoPath: targetPath,
			sourceLabel: fileName,
			auditSource: videoUrl ?? fileName,
			cleanup: async () => {
				await rm(tempDir, { recursive: true, force: true });
			},
		};
	} catch (error) {
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
}

export function createGatewayTaskDraftHandlers(
	options: CreateGatewayTaskDraftHandlersOptions,
): GatewayTaskDraftHandlers {
	const videoTeachAnalyzer = options.videoTeachAnalyzer ?? resolveDefaultVideoTeachAnalyzer(options);
	const createFromVideo: GatewayTaskDraftHandlers["createFromVideo"] = async (params) => {
		const entry = resolveSessionEntry(options.sessionEntries, params);
		if (!entry) {
			throw new Error("sessionId is required");
		}
		if (!entry.workspaceDir) {
			throw new Error(`Session ${entry.id} is not bound to a workspace`);
		}
		const source = await materializeVideoSource({
			videoPath: asString(params?.videoPath),
			videoUrl: asString(params?.videoUrl),
			videoDataUrl: asString(params?.videoDataUrl),
			videoName: asString(params?.videoName),
		});
		const artifactDir = resolveVideoTeachArtifactDir(entry, source.sourceLabel);
		const keyframeOutputDir = join(artifactDir, "keyframes");
		const capabilitySnapshot = buildTeachCapabilitySnapshot({
			workspaceDir: entry.workspaceDir,
			config: options.config,
		});
		let keepArtifacts = false;
		try {
			const analysis = await videoTeachAnalyzer.analyze({
				videoPath: source.videoPath,
				sourceLabel: source.sourceLabel,
				objectiveHint: asString(params?.objective),
				capabilitySnapshot,
				eventLogPath: asString(params?.eventLogPath),
				events: Array.isArray(params?.events) ? params?.events as DemonstrationEvent[] : undefined,
				maxEpisodes: asNumber(params?.maxEpisodes) ?? undefined,
				maxKeyframes: asNumber(params?.maxKeyframes) ?? undefined,
				keyframeOutputDir,
			});
			keepArtifacts = true;
				const draft = createTaughtTaskDraftFromVideo({
				workspaceDir: entry.workspaceDir,
				repoRoot: entry.repoRoot,
				sessionId: entry.id,
				title: asString(params?.title) ?? analysis.title,
				objective: asString(params?.objective) ?? analysis.objective,
				sourceLabel: analysis.sourceLabel,
				promptPreview: analysis.summary ?? analysis.objective,
				responsePreview: `Video teach analysis via ${analysis.provider}.`,
				taskKind: analysis.taskKind,
				parameterSlots: analysis.parameterSlots.map((slot) => ({
					name: slot.name,
					label: slot.label ?? slot.name,
					sampleValue: slot.sampleValue,
					required: slot.required !== false,
					notes: slot.notes,
				})),
				successCriteria: analysis.successCriteria,
				openQuestions: analysis.openQuestions,
				taskCard: analysis.taskCard,
				procedure: analysis.procedure,
				executionPolicy: analysis.executionPolicy,
				stepRouteOptions: analysis.stepRouteOptions,
				replayPreconditions: analysis.replayPreconditions,
				resetSignals: analysis.resetSignals,
				skillDependencies: analysis.skillDependencies,
				steps: analysis.steps.map((step, index) => ({
					id: `${step.toolName}-${index + 1}`,
					index: index + 1,
					route: step.route,
					toolName: step.toolName,
					instruction: step.instruction,
					summary: step.summary,
					target: step.target,
					app: step.app,
					scope: step.scope,
					inputs: step.inputs,
					...(step.captureMode ? { captureMode: step.captureMode } : {}),
					...(step.groundingMode ? { groundingMode: step.groundingMode } : {}),
					...(step.locationHint ? { locationHint: step.locationHint } : {}),
					...(step.windowTitle ? { windowTitle: step.windowTitle } : {}),
					verificationSummary: step.verificationSummary,
					uncertain: step.uncertain,
				})),
				sourceDetails: {
					videoSource: source.auditSource,
					videoPath: source.videoPath,
					eventLogPath: asString(params?.eventLogPath),
					artifactDir,
					keyframeDir: keyframeOutputDir,
					keyframes: normalizeEvidenceKeyframes(analysis.keyframes),
					analyzerProvider: analysis.provider,
					analyzerModel: analysis.model,
					analysisMode: analysis.analysisMode,
					evidenceSummary: analysis.evidenceSummary,
					episodeCount: analysis.episodeCount,
					keyframeCount: analysis.keyframeCount,
					eventCount: analysis.eventCount,
					durationMs: analysis.durationMs,
				},
				});
				await persistTaughtTaskDraft(draft);
				if (asBoolean(params?.publish) === true) {
					const validatedDraft = await ensureDraftValidated(options, draft, params);
					const published = await publishTaughtTaskDraft({
						workspaceDir: entry.workspaceDir,
						draftId: validatedDraft.id,
						name: asString(params?.name),
					});
					return { draft: published.draft, created: true };
			}
			return { draft, created: true };
		} finally {
			if (!keepArtifacts) {
				await rm(artifactDir, { recursive: true, force: true }).catch(() => {});
			}
			await source.cleanup?.();
		}
	};
	return {
		list: async (params) => {
			const workspaceDir = resolveWorkspaceDir(options, params);
			if (!workspaceDir) {
				return { drafts: [] };
			}
			return {
				workspaceDir,
				drafts: await listTaughtTaskDrafts({ workspaceDir }),
			};
		},
		get: async (params) => {
			const workspaceDir = resolveWorkspaceDir(options, params);
			const draftId = asString(params?.draftId);
			if (!workspaceDir || !draftId) {
				throw new Error("workspaceDir and draftId are required");
			}
			return await loadTaughtTaskDraft({ workspaceDir, draftId }) ?? null;
		},
		create: async (params) => {
			if (isVideoTeachCreateRequest(params)) {
				return await createFromVideo(params);
			}
			const entry = resolveSessionEntry(options.sessionEntries, params);
			if (!entry) {
				throw new Error("sessionId is required");
			}
			if (!entry.workspaceDir) {
				throw new Error(`Session ${entry.id} is not bound to a workspace`);
			}
			const run = resolveRun(entry, params);
			if (!run) {
				throw new Error(`No traced run found for session ${entry.id}`);
			}
			const existingDraftId = asString(params?.draftId);
			if (existingDraftId) {
				const existing = await loadTaughtTaskDraft({
					workspaceDir: entry.workspaceDir,
					draftId: existingDraftId,
				});
				if (existing) {
					return { draft: existing, created: false };
				}
			}
				const draft = createTaughtTaskDraft({
				workspaceDir: entry.workspaceDir,
				repoRoot: entry.repoRoot,
				sessionId: entry.id,
				title: asString(params?.title),
				objective: asString(params?.objective),
				run,
				});
				await persistTaughtTaskDraft(draft);
				if (asBoolean(params?.publish) === true) {
					const validatedDraft = await ensureDraftValidated(options, draft, params);
					const published = await publishTaughtTaskDraft({
						workspaceDir: entry.workspaceDir,
						draftId: validatedDraft.id,
						name: asString(params?.name),
					});
					return { draft: published.draft, created: true };
			}
			return { draft, created: true };
		},
		createFromVideo,
		update: async (params) => {
			const workspaceDir = resolveWorkspaceDir(options, params);
			const draftId = asString(params?.draftId);
			if (!workspaceDir || !draftId) {
				throw new Error("workspaceDir and draftId are required");
			}
			const patch = (params?.patch && typeof params.patch === "object")
				? params.patch as Record<string, unknown>
				: params ?? {};
				return await updateTaughtTaskDraft({
					workspaceDir,
					draftId,
					patch: {
						...(asString(patch.title) ? { title: asString(patch.title) } : {}),
						...(asString(patch.intent) ? { intent: asString(patch.intent) } : {}),
						...(asString(patch.objective) ? { objective: asString(patch.objective) } : {}),
						...(asString(patch.taskKind) ? { taskKind: asString(patch.taskKind) as any } : {}),
						...(Array.isArray(patch.parameterSlots) ? { parameterSlots: patch.parameterSlots as any } : {}),
						...(Array.isArray(patch.successCriteria) ? { successCriteria: patch.successCriteria as any } : {}),
						...(Array.isArray(patch.openQuestions) ? { openQuestions: patch.openQuestions as any } : {}),
						...(Array.isArray(patch.uncertainties) ? { uncertainties: patch.uncertainties as any } : {}),
						...(asRecord(patch.taskCard) ? { taskCard: asRecord(patch.taskCard) as any } : {}),
						...(Array.isArray(patch.procedure) ? { procedure: patch.procedure as any } : {}),
						...(asRecord(patch.executionPolicy) ? { executionPolicy: asRecord(patch.executionPolicy) as any } : {}),
						...(Array.isArray(patch.stepRouteOptions) ? { stepRouteOptions: patch.stepRouteOptions as any } : {}),
						...(Array.isArray(patch.replayPreconditions) ? { replayPreconditions: patch.replayPreconditions as any } : {}),
						...(Array.isArray(patch.resetSignals) ? { resetSignals: patch.resetSignals as any } : {}),
						...(Array.isArray(patch.skillDependencies) ? { skillDependencies: patch.skillDependencies as any } : {}),
						...(Array.isArray(patch.steps) ? { steps: patch.steps as any } : {}),
						...(asRecord(patch.validation) && Object.keys(asRecord(patch.validation)).length > 0 ? { validation: asRecord(patch.validation) as any } : {}),
						...(asString(patch.note) ? { note: asString(patch.note) } : {}),
					},
					action: asString(params?.action) as any,
					note: asString(params?.note) ?? asString(patch.note),
				});
			},
		publish: async (params) => {
			const workspaceDir = resolveWorkspaceDir(options, params);
			const draftId = asString(params?.draftId);
			if (!workspaceDir || !draftId) {
				throw new Error("workspaceDir and draftId are required");
			}
				const draft = await loadTaughtTaskDraft({ workspaceDir, draftId });
				if (!draft) {
					throw new Error(`Task draft not found: ${draftId}`);
				}
				await ensureDraftValidated(options, draft, params);
				return await publishTaughtTaskDraft({
					workspaceDir,
					draftId,
				name: asString(params?.name),
			});
		},
	};
}
