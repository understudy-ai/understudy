import { describe, expect, it } from "vitest";
import {
	asBoolean,
	asNumber,
	asString,
	buildNestedPatch,
	buildSessionKey,
	buildWorkspaceScopeDiscriminator,
} from "./gateway-support.js";
import {
	hashJsonPayload,
	matchesExecApprovalPattern,
	normalizeExecApprovalsFile,
	redactExecApprovalsFile,
} from "./gateway-exec-approvals.js";

describe("gateway support session keys", () => {
	it("appends an opaque workspace discriminator when provided", () => {
		const discriminator = buildWorkspaceScopeDiscriminator("/tmp/demo/project");
		const key = buildSessionKey({
			scope: "channel_sender",
			dmScope: "sender",
			channelId: "web",
			senderId: "user-1",
			scopeDiscriminator: discriminator,
		});

		expect(discriminator).toMatch(/^ws_[a-f0-9]{12}$/);
		expect(discriminator).not.toContain("/tmp/demo/project");
		expect(key).toBe(`channel_sender:web:user-1:${discriminator}`);
	});

	it("builds nested config patches from dotted paths", () => {
		expect(buildNestedPatch("gateway.auth.token", "secret")).toEqual({
			gateway: {
				auth: {
					token: "secret",
				},
			},
		});
		expect(buildNestedPatch("  ", "ignored")).toEqual({});
	});

	it("normalizes exec approval files and preserves current socket path", () => {
		const normalized = normalizeExecApprovalsFile(
			{
				defaults: {
					security: "strict",
					askFallback: "legacy-mode",
					autoAllowSkills: "true",
				},
				agents: {
					ops: {
						ask: "always",
						askFallback: "legacy-agent-mode",
						allowlist: [
							{ pattern: "npm test", id: "rule-1", lastUsedAt: "42" },
							{ pattern: "   " },
						],
					},
				},
				socket: {
					token: "secret-token",
				},
			},
			{
				version: 1,
				socket: { path: "/tmp/understudy.sock" },
			},
		);

		expect(normalized).toEqual({
			version: 1,
			socket: {
				path: "/tmp/understudy.sock",
				token: "secret-token",
			},
			defaults: {
				security: "strict",
				autoAllowSkills: true,
			},
			agents: {
				ops: {
					ask: "always",
					allowlist: [
						{ pattern: "npm test", id: "rule-1", lastUsedAt: 42 },
					],
				},
			},
		});
	});

	it("redacts socket tokens and supports exact, wildcard, and regex pattern matches", () => {
		expect(redactExecApprovalsFile({
			version: 1,
			socket: {
				path: "/tmp/understudy.sock",
				token: "secret-token",
			},
		})).toEqual({
			version: 1,
			socket: {
				path: "/tmp/understudy.sock",
			},
		});
		expect(matchesExecApprovalPattern("npm *", "npm test --watch")).toBe(true);
		expect(matchesExecApprovalPattern("/^git\\s+status$/", "git status")).toBe(true);
		expect(matchesExecApprovalPattern("exact command", "exact command")).toBe(true);
		expect(matchesExecApprovalPattern("exact command", "exact command --extra")).toBe(false);
	});

	it("normalizes primitive helpers and produces stable JSON hashes", () => {
		expect(asString("  hello  ")).toBe("hello");
		expect(asNumber("42")).toBe(42);
		expect(asBoolean("false")).toBe(false);
		expect(hashJsonPayload({ a: 1 })).toBe(hashJsonPayload({ a: 1 }));
		expect(hashJsonPayload({ a: 1 })).not.toBe(hashJsonPayload({ a: 2 }));
	});
});
