import { describe, expect, it } from "vitest";
import {
	appendExecOutput,
	createExecSessionRecord,
	drainExecSession,
	getPendingCharsForSession,
} from "../exec-sessions.js";

describe("exec session pending output trimming", () => {
	it("keeps the most recent pending output even when a later chunk exceeds the cap", () => {
		const session = createExecSessionRecord({
			command: "echo test",
			maxOutputChars: 20,
			pendingMaxOutputChars: 5,
		});
		session.pendingMaxOutputChars = 5;

		appendExecOutput(session, "stdout", "ab");
		appendExecOutput(session, "stdout", "cd");
		appendExecOutput(session, "stdout", "012345");

		expect(getPendingCharsForSession(session)).toEqual({
			stdout: 5,
			stderr: 0,
		});
		expect(drainExecSession(session)).toEqual({
			stdout: "12345",
			stderr: "",
		});
	});
});
