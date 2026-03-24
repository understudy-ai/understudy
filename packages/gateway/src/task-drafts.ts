import {
	createTaughtTaskDraft,
	lintTaughtTaskDraft,
	listTaughtTaskDrafts,
	loadTaughtTaskDraft,
	persistTaughtTaskDraft,
	publishTaughtTaskDraft,
	updatePersistedTaughtTaskDraft,
	type TaughtTaskDraft,
} from "@understudy/core";
import type { UnderstudyConfig } from "@understudy/types";
import type { SessionEntry, SessionRunTrace } from "./session-runtime.js";
import { asBoolean, asRecord, asString } from "./value-coerce.js";

export interface CreateGatewayTaskDraftHandlersOptions {
	sessionEntries: Map<string, SessionEntry>;
	resolveDefaultWorkspaceDir?: () => string | undefined;
	config?: UnderstudyConfig;
}

export interface GatewayTaskDraftHandlers {
	list(params?: Record<string, unknown>): Promise<{ workspaceDir?: string; drafts: TaughtTaskDraft[] }>;
	get(params?: Record<string, unknown>): Promise<TaughtTaskDraft | null>;
	create(params?: Record<string, unknown>): Promise<{ draft: TaughtTaskDraft; created: boolean }>;
	update(params?: Record<string, unknown>): Promise<TaughtTaskDraft>;
	publish(params?: Record<string, unknown>): Promise<Awaited<ReturnType<typeof publishTaughtTaskDraft>>>;
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
		(draft.artifactKind === "playbook" ? draft.playbookStages.length > 0 : draft.steps.length > 0) &&
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

export function createGatewayTaskDraftHandlers(
	options: CreateGatewayTaskDraftHandlersOptions,
): GatewayTaskDraftHandlers {
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
		update: async (params) => {
			const workspaceDir = resolveWorkspaceDir(options, params);
			const draftId = asString(params?.draftId);
			if (!workspaceDir || !draftId) {
				throw new Error("workspaceDir and draftId are required");
			}
			const patch = (params?.patch && typeof params.patch === "object")
				? params.patch as Record<string, unknown>
				: params ?? {};
				return await updatePersistedTaughtTaskDraft({
					workspaceDir,
					draftId,
					patch: {
						...(asString(patch.title) ? { title: asString(patch.title) } : {}),
						...(asString(patch.intent) ? { intent: asString(patch.intent) } : {}),
						...(asString(patch.objective) ? { objective: asString(patch.objective) } : {}),
						...(asString(patch.artifactKind) ? { artifactKind: asString(patch.artifactKind) as any } : {}),
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
						...(Array.isArray(patch.childArtifacts) ? { childArtifacts: patch.childArtifacts as any } : {}),
						...(Array.isArray(patch.playbookStages) ? { playbookStages: patch.playbookStages as any } : {}),
						...(asRecord(patch.workerContract) ? { workerContract: asRecord(patch.workerContract) as any } : {}),
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
