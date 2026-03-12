import { beforeEach, describe, expect, it, vi } from "vitest";
import { installInteractiveTeachSupport } from "./chat-interactive-teach.js";

const callMock = vi.fn();

vi.mock("../rpc-client.js", () => ({
	createRpcClient: vi.fn(() => ({
		url: "http://127.0.0.1:23333",
		call: callMock,
	})),
}));

vi.mock("./gateway-browser-auth.js", () => ({
	resolveGatewayBrowserToken: vi.fn().mockResolvedValue("test-token"),
}));

describe("installInteractiveTeachSupport", () => {
	beforeEach(() => {
		callMock.mockReset();
	});

	it("routes /teach commands through the gateway and does not send them to the model", async () => {
		callMock
			.mockResolvedValueOnce({ id: "session-teach-1" })
			.mockResolvedValueOnce({
				sessionId: "session-teach-1",
				response: "Started teach recording for this workspace session.",
			});

		const originalSubmit = vi.fn().mockResolvedValue(undefined);
		const addMessageToChat = vi.fn();
		const showStatus = vi.fn();
		const showError = vi.fn();
		const setText = vi.fn();
		const requestRender = vi.fn();
		const interactive = {
			init: vi.fn().mockResolvedValue(undefined),
			defaultEditor: {
				onSubmit: originalSubmit,
				setText,
			},
			addMessageToChat,
			ui: {
				requestRender,
			},
			showStatus,
			showError,
		};

		await installInteractiveTeachSupport({
			interactive,
			cwd: "/tmp/workspace",
			configPath: "/tmp/config.json",
		});

		await interactive.defaultEditor.onSubmit?.("/teach start");

		expect(originalSubmit).not.toHaveBeenCalled();
		expect(callMock).toHaveBeenNthCalledWith(
			1,
			"session.create",
			expect.objectContaining({
				channelId: "terminal",
				senderId: "understudy-chat",
				cwd: "/tmp/workspace",
				forceNew: false,
			}),
			expect.any(Object),
		);
		expect(callMock).toHaveBeenNthCalledWith(
			2,
			"session.send",
			expect.objectContaining({
				sessionId: "session-teach-1",
				message: "/teach start",
				cwd: "/tmp/workspace",
				waitForCompletion: true,
			}),
			expect.any(Object),
		);
		expect(setText).toHaveBeenCalledWith("");
		expect(showError).not.toHaveBeenCalled();
		expect(showStatus).not.toHaveBeenCalled();
		expect(addMessageToChat).toHaveBeenNthCalledWith(1, expect.objectContaining({
			role: "user",
			content: "/teach start",
		}), {
			populateHistory: true,
		});
		expect(addMessageToChat).toHaveBeenNthCalledWith(2, expect.objectContaining({
			role: "assistant",
			model: "teach-clarification",
			provider: "understudy-gateway",
		}), undefined);
		expect(requestRender).toHaveBeenCalledTimes(2);
	});

	it("passes non-teach input through to the original TUI submit handler", async () => {
		const originalSubmit = vi.fn().mockResolvedValue(undefined);
		const interactive = {
			init: vi.fn().mockResolvedValue(undefined),
			defaultEditor: {
				onSubmit: originalSubmit,
				setText: vi.fn(),
			},
			showStatus: vi.fn(),
			showError: vi.fn(),
		};

		await installInteractiveTeachSupport({
			interactive,
			cwd: "/tmp/workspace",
		});

		await interactive.defaultEditor.onSubmit?.("normal prompt");

		expect(originalSubmit).toHaveBeenCalledWith("normal prompt");
		expect(callMock).not.toHaveBeenCalled();
	});

	it("routes bare /teach through the gateway so the current teach status is visible", async () => {
		callMock
			.mockResolvedValueOnce({ id: "session-teach-1" })
			.mockResolvedValueOnce({
				sessionId: "session-teach-1",
				response: "Teach status:\n- Recording: idle",
				meta: {
					directCommand: "teach_help",
					teachClarification: {
						draftId: "draft-1",
						status: "clarifying",
					},
				},
			});

		const originalSubmit = vi.fn().mockResolvedValue(undefined);
		const interactive = {
			init: vi.fn().mockResolvedValue(undefined),
			defaultEditor: {
				onSubmit: originalSubmit,
				setText: vi.fn(),
			},
			addMessageToChat: vi.fn(),
			ui: {
				requestRender: vi.fn(),
			},
			showStatus: vi.fn(),
			showError: vi.fn(),
		};

		await installInteractiveTeachSupport({
			interactive,
			cwd: "/tmp/workspace",
		});

		await interactive.defaultEditor.onSubmit?.("/teach");
		await interactive.defaultEditor.onSubmit?.("继续用当前页面的数据");

		expect(originalSubmit).not.toHaveBeenCalled();
		expect(callMock).toHaveBeenNthCalledWith(
			2,
			"session.send",
			expect.objectContaining({
				sessionId: "session-teach-1",
				message: "/teach",
			}),
			expect.any(Object),
		);
		expect(callMock).toHaveBeenNthCalledWith(
			3,
			"session.send",
			expect.objectContaining({
				sessionId: "session-teach-1",
				message: "继续用当前页面的数据",
			}),
			expect.any(Object),
		);
	});

	it("routes plain-language clarification replies back through the active teach gateway session", async () => {
		callMock
			.mockResolvedValueOnce({ id: "session-teach-1" })
			.mockResolvedValueOnce({
				sessionId: "session-teach-1",
				response: "Entered teach clarification mode.",
				meta: {
					directCommand: "teach_stop",
					teachClarification: {
						draftId: "draft-1",
						status: "clarifying",
					},
				},
			})
			.mockResolvedValueOnce({
				sessionId: "session-teach-1",
				response: "Updated teach task card for draft `draft-1`.",
				meta: {
					directCommand: "teach_clarify",
					teachClarification: {
						draftId: "draft-1",
						status: "ready",
					},
				},
			});

		const originalSubmit = vi.fn().mockResolvedValue(undefined);
		const addMessageToChat = vi.fn();
		const interactive = {
			init: vi.fn().mockResolvedValue(undefined),
			defaultEditor: {
				onSubmit: originalSubmit,
				setText: vi.fn(),
			},
			addMessageToChat,
			ui: {
				requestRender: vi.fn(),
			},
			showStatus: vi.fn(),
			showError: vi.fn(),
		};

		await installInteractiveTeachSupport({
			interactive,
			cwd: "/tmp/workspace",
		});

		await interactive.defaultEditor.onSubmit?.("/teach stop");
		await interactive.defaultEditor.onSubmit?.("目标是看最新三个 stock picks，算涨幅选最高的");

		expect(originalSubmit).not.toHaveBeenCalled();
		expect(callMock).toHaveBeenNthCalledWith(
			3,
			"session.send",
			expect.objectContaining({
				sessionId: "session-teach-1",
				message: "目标是看最新三个 stock picks，算涨幅选最高的",
				cwd: "/tmp/workspace",
				waitForCompletion: true,
			}),
			expect.any(Object),
		);
		expect(addMessageToChat.mock.calls).toEqual(expect.arrayContaining([[
			expect.objectContaining({
				role: "user",
				content: "目标是看最新三个 stock picks，算涨幅选最高的",
			}),
			{ populateHistory: true },
		]]));
		expect(addMessageToChat.mock.calls).toEqual(expect.arrayContaining([[
			expect.objectContaining({
				role: "assistant",
				content: [{
					type: "text",
					text: "Teach: refining the task card from your latest reply...",
				}],
			}),
			{ populateHistory: false },
		]]));
	});

	it("shows immediate and staged feedback while /teach stop is still running", async () => {
		vi.useFakeTimers();
		try {
			let resolveTeachTurn: ((value: Record<string, unknown>) => void) | undefined;
			callMock
				.mockResolvedValueOnce({ id: "session-teach-1" })
				.mockImplementationOnce(() => new Promise((resolve) => {
					resolveTeachTurn = resolve as (value: Record<string, unknown>) => void;
				}));

			const addMessageToChat = vi.fn();
			const showStatus = vi.fn();
			const interactive = {
				init: vi.fn().mockResolvedValue(undefined),
				defaultEditor: {
					onSubmit: vi.fn().mockResolvedValue(undefined),
					setText: vi.fn(),
				},
				addMessageToChat,
				ui: {
					requestRender: vi.fn(),
				},
				showStatus,
				showError: vi.fn(),
			};

			await installInteractiveTeachSupport({
				interactive,
				cwd: "/tmp/workspace",
			});

			const stopPromise = interactive.defaultEditor.onSubmit?.("/teach stop");
			await Promise.resolve();

			expect(addMessageToChat).toHaveBeenNthCalledWith(1, expect.objectContaining({
				role: "user",
				content: "/teach stop",
			}), {
				populateHistory: true,
			});
			expect(addMessageToChat).toHaveBeenNthCalledWith(2, expect.objectContaining({
				role: "assistant",
				content: [{ type: "text", text: "Teach stop received. Stopping the recording and preparing the demo analysis..." }],
			}), {
				populateHistory: false,
			});
			expect(addMessageToChat).toHaveBeenNthCalledWith(3, expect.objectContaining({
				role: "assistant",
				content: [{ type: "text", text: "Note: Screen keyframes captured during recording will be sent to your configured LLM provider for analysis." }],
			}), {
				populateHistory: false,
			});
			expect(addMessageToChat).toHaveBeenNthCalledWith(4, expect.objectContaining({
				role: "assistant",
				content: [{ type: "text", text: "Teach: stopping the recording and preparing the analysis..." }],
			}), {
				populateHistory: false,
			});
			expect(showStatus).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1_500);
			expect(addMessageToChat.mock.calls).toEqual(expect.arrayContaining([[
				expect.objectContaining({
					role: "assistant",
					content: [{ type: "text", text: "Teach: extracting keyframes and event evidence..." }],
				}),
				{ populateHistory: false },
			]]));

			await vi.advanceTimersByTimeAsync(4_500);
			expect(showStatus).not.toHaveBeenCalled();

			resolveTeachTurn?.({
				sessionId: "session-teach-1",
				response: "Entered teach clarification mode.",
				meta: {
					directCommand: "teach_stop",
					teachClarification: {
						draftId: "draft-1",
						status: "clarifying",
					},
				},
			});
			await stopPromise;

			expect(showStatus).toHaveBeenCalledTimes(1);
			expect(showStatus).toHaveBeenLastCalledWith("Teach analysis complete.");
		} finally {
			vi.useRealTimers();
		}
	});

	it("shows publish progress feedback while /teach publish is still running", async () => {
		vi.useFakeTimers();
		try {
			let resolveTeachTurn: ((value: Record<string, unknown>) => void) | undefined;
			callMock
				.mockResolvedValueOnce({ id: "session-teach-1" })
				.mockImplementationOnce(() => new Promise((resolve) => {
					resolveTeachTurn = resolve as (value: Record<string, unknown>) => void;
				}));

			const addMessageToChat = vi.fn();
			const showStatus = vi.fn();
			const interactive = {
				init: vi.fn().mockResolvedValue(undefined),
				defaultEditor: {
					onSubmit: vi.fn().mockResolvedValue(undefined),
					setText: vi.fn(),
				},
				addMessageToChat,
				ui: {
					requestRender: vi.fn(),
				},
				showStatus,
				showError: vi.fn(),
			};

			await installInteractiveTeachSupport({
				interactive,
				cwd: "/tmp/workspace",
			});

			const publishPromise = interactive.defaultEditor.onSubmit?.("/teach publish draft-1 weekly-report");
			await Promise.resolve();

			expect(addMessageToChat).toHaveBeenNthCalledWith(2, expect.objectContaining({
				role: "assistant",
				content: [{ type: "text", text: "Teach publish received. Publishing the skill and refreshing matching workspace sessions..." }],
			}), {
				populateHistory: false,
			});
			expect(addMessageToChat).toHaveBeenNthCalledWith(3, expect.objectContaining({
				role: "assistant",
				content: [{ type: "text", text: "Teach: publishing the skill and refreshing live workspace sessions..." }],
			}), {
				populateHistory: false,
			});

			await vi.advanceTimersByTimeAsync(4_000);
			expect(addMessageToChat.mock.calls).toEqual(expect.arrayContaining([[
				expect.objectContaining({
					role: "assistant",
					content: [{ type: "text", text: "Teach: still publishing the skill and refreshing session prompts..." }],
				}),
				{ populateHistory: false },
			]]));

			resolveTeachTurn?.({
				sessionId: "session-teach-1",
				response: "Published teach skill.",
			});
			await publishPromise;

			expect(showStatus).toHaveBeenCalledWith("Teach skill published.");
		} finally {
			vi.useRealTimers();
		}
	});

	it("clears the local clarification routing state after /teach confirm", async () => {
		callMock
			.mockResolvedValueOnce({ id: "session-teach-1" })
			.mockResolvedValueOnce({
				sessionId: "session-teach-1",
				response: "Entered teach clarification mode.",
				meta: {
					directCommand: "teach_stop",
					teachClarification: {
						draftId: "draft-1",
						status: "clarifying",
					},
				},
			})
			.mockResolvedValueOnce({
				sessionId: "session-teach-1",
				response: "Task card confirmed.",
				meta: {
					directCommand: "teach_confirm",
				},
			});

		const originalSubmit = vi.fn().mockResolvedValue(undefined);
		const interactive = {
			init: vi.fn().mockResolvedValue(undefined),
			defaultEditor: {
				onSubmit: originalSubmit,
				setText: vi.fn(),
			},
			addMessageToChat: vi.fn(),
			ui: {
				requestRender: vi.fn(),
			},
			showStatus: vi.fn(),
			showError: vi.fn(),
		};

		await installInteractiveTeachSupport({
			interactive,
			cwd: "/tmp/workspace",
		});

		await interactive.defaultEditor.onSubmit?.("/teach stop");
		await interactive.defaultEditor.onSubmit?.("/teach confirm");
		await interactive.defaultEditor.onSubmit?.("normal prompt");

		expect(originalSubmit).toHaveBeenCalledWith("normal prompt");
		expect(callMock).toHaveBeenCalledTimes(3);
	});

	it("blocks a second teach submission while the first clarification turn is still running", async () => {
		let resolveTeachTurn: ((value: Record<string, unknown>) => void) | undefined;
		callMock
			.mockResolvedValueOnce({ id: "session-teach-1" })
			.mockImplementationOnce(() => new Promise((resolve) => {
				resolveTeachTurn = resolve as (value: Record<string, unknown>) => void;
			}));

		const interactive = {
			init: vi.fn().mockResolvedValue(undefined),
			defaultEditor: {
				onSubmit: vi.fn().mockResolvedValue(undefined),
				setText: vi.fn(),
			},
			addMessageToChat: vi.fn(),
			ui: {
				requestRender: vi.fn(),
			},
			showStatus: vi.fn(),
			showError: vi.fn(),
		};

		await installInteractiveTeachSupport({
			interactive,
			cwd: "/tmp/workspace",
		});

		const first = interactive.defaultEditor.onSubmit?.("/teach stop");
		await Promise.resolve();
		await interactive.defaultEditor.onSubmit?.("输出所有的");

		expect(interactive.showError).toHaveBeenCalledWith(
			"Teach clarification is still processing. Wait for the current reply before sending another message.",
		);
		expect(callMock).toHaveBeenCalledTimes(2);

		resolveTeachTurn?.({
			sessionId: "session-teach-1",
			response: "Entered teach clarification mode.",
			meta: {
				directCommand: "teach_stop",
				teachClarification: {
					draftId: "draft-1",
					status: "clarifying",
				},
			},
		});
		await first;
	});
});
