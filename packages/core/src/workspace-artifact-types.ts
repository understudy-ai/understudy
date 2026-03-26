export type WorkspaceArtifactKind = "skill" | "worker" | "playbook";
export type WorkspacePlaybookStageKind = "skill" | "worker" | "inline" | "approval";
export type WorkspacePlaybookApprovalGate = string;

export interface WorkspaceArtifactChildRef {
	name: string;
	artifactKind: Exclude<WorkspaceArtifactKind, "playbook">;
	required: boolean;
	reason?: string;
}

export function normalizeWorkspacePlaybookApprovalGate(
	value: unknown,
): WorkspacePlaybookApprovalGate | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
