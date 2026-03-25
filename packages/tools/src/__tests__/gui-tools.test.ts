import { describe, expect, it, vi } from "vitest";
import {
	createDefaultGuiRuntime,
	createGuiClickTool,
	createGuiDragTool,
	createGuiKeyTool,
	createGuiMoveTool,
	createGuiObserveTool,
	createGuiScrollTool,
	createGuiTypeTool,
	createGuiWaitTool,
	listGuiToolCatalog,
	setDefaultGuiRuntime,
} from "../gui-tools.js";

function createRuntime() {
	return {
		observe: vi.fn().mockResolvedValue({
			text: "Observed Mail compose window",
			observation: {
				platform: process.platform,
				method: "screenshot",
				appName: "Mail",
				windowTitle: "New Message",
				capturedAt: Date.now(),
			},
			resolution: {
				method: "grounding",
				confidence: 0.94,
				reason: "Matched Send button",
			},
			status: {
				code: "observed",
				summary: "Mail compose window observed",
			},
			details: {
				grounding_method: "grounding",
			},
			image: {
				data: Buffer.from("png-bytes").toString("base64"),
				mimeType: "image/png",
				filename: "gui-screenshot.png",
			},
		}),
		click: vi.fn().mockResolvedValue({
			text: "Clicked Send button",
			status: {
				code: "action_sent",
				summary: "Triggered Send button",
			},
			details: {
				grounding_method: "grounding",
				confidence: 0.91,
			},
		}),
		drag: vi.fn().mockResolvedValue({
			text: "Dragged file to Trash",
			status: {
				code: "action_sent",
				summary: "Moved file to Trash",
			},
			details: {
				grounding_method: "grounding",
				confidence: 0.87,
			},
		}),
		scroll: vi.fn().mockResolvedValue({
			text: "Scrolled down",
			status: {
				code: "action_sent",
				summary: "Scrolled messages list",
			},
			details: {
				grounding_method: "grounding",
				confidence: 0.8,
			},
		}),
		type: vi.fn().mockResolvedValue({
			text: "Typed into Subject field",
			status: {
				code: "action_sent",
				summary: "Typed into Subject field",
			},
			details: {
				grounding_method: "grounding",
				confidence: 0.88,
			},
		}),
		key: vi.fn().mockResolvedValue({
			text: "Pressed Enter",
			status: {
				code: "action_sent",
				summary: "Pressed Enter",
			},
			details: {
				grounding_method: "targetless",
				confidence: 1,
			},
		}),
		wait: vi.fn().mockResolvedValue({
			text: "Wait condition satisfied",
			status: {
				code: "condition_met",
				summary: "Send confirmation appeared",
			},
			details: {
				grounding_method: "grounding",
			},
		}),
		move: vi.fn().mockResolvedValue({
			text: "Moved cursor to (100, 200)",
			status: {
				code: "action_sent",
				summary: "Cursor moved",
			},
			details: {
				grounding_method: "grounding",
			},
		}),
	};
}

describe("gui tool wrappers", () => {
	it("exposes first-class gui tools and forwards structured runtime results", async () => {
		const runtime = createRuntime();
		const observeTool = createGuiObserveTool(runtime as any);
		const clickTool = createGuiClickTool(runtime as any);
		const dragTool = createGuiDragTool(runtime as any);
		const scrollTool = createGuiScrollTool(runtime as any);
		const typeTool = createGuiTypeTool(runtime as any);
		const keyTool = createGuiKeyTool(runtime as any);
		const waitTool = createGuiWaitTool(runtime as any);
		const moveTool = createGuiMoveTool(runtime as any);

		expect(observeTool.name).toBe("gui_observe");
		expect(clickTool.name).toBe("gui_click");
		expect(dragTool.name).toBe("gui_drag");
		expect(scrollTool.name).toBe("gui_scroll");
		expect(typeTool.name).toBe("gui_type");
		expect(keyTool.name).toBe("gui_key");
		expect(waitTool.name).toBe("gui_wait");
		expect(moveTool.name).toBe("gui_move");

		// gui_observe
		const observeResult = await observeTool.execute("tool-1", { app: "Mail", target: "Send button" });
		expect((observeResult.content[0] as any).text).toContain("Observed Mail compose window");
			expect(observeResult.details).toMatchObject({
				observation: expect.objectContaining({ appName: "Mail", method: "screenshot" }),
				resolution: expect.objectContaining({ reason: "Matched Send button" }),
				status: expect.objectContaining({ code: "observed" }),
				grounding_method: "grounding",
			});
		expect(runtime.observe).toHaveBeenCalledWith({ app: "Mail", target: "Send button" }, undefined);

		// gui_click — basic left click with window selector
		const clickResult = await clickTool.execute("tool-2", {
			target: "Send button",
			captureMode: "display",
			windowTitle: "New Message",
			windowSelector: {
				titleContains: "Message",
				index: 1,
			},
		});
		expect((clickResult.content[0] as any).text).toContain("Clicked Send button");
		expect(runtime.click).toHaveBeenCalledWith({
			target: "Send button",
			captureMode: "display",
			windowTitle: "New Message",
			windowSelector: {
				titleContains: "Message",
				index: 1,
			},
		}, undefined);
			expect(clickResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
				confidence: 0.91,
			});

		// gui_click with button:"right"
		runtime.click.mockClear();
		const rightClickResult = await clickTool.execute("tool-2b", { target: "Send button", button: "right" });
		expect((rightClickResult.content[0] as any).text).toContain("Clicked Send button");
		expect(runtime.click).toHaveBeenCalledWith({ target: "Send button", button: "right" }, undefined);

		// gui_click with clicks:2
		runtime.click.mockClear();
		const doubleClickResult = await clickTool.execute("tool-3", { target: "Downloads folder", clicks: 2 });
		expect((doubleClickResult.content[0] as any).text).toContain("Clicked Send button");
		expect(runtime.click).toHaveBeenCalledWith({ target: "Downloads folder", clicks: 2 }, undefined);

		// gui_click with button:"none" (hover)
		runtime.click.mockClear();
		const hoverResult = await clickTool.execute("tool-3b", {
			target: "Preview card",
			button: "none",
			settleMs: 240,
		});
		expect((hoverResult.content[0] as any).text).toContain("Clicked Send button");
		expect(runtime.click).toHaveBeenCalledWith({ target: "Preview card", button: "none", settleMs: 240 }, undefined);

		// gui_click with holdMs (click and hold)
		runtime.click.mockClear();
		const clickAndHoldResult = await clickTool.execute("tool-3c", {
			target: "Record button",
			holdMs: 900,
		});
		expect((clickAndHoldResult.content[0] as any).text).toContain("Clicked Send button");
		expect(runtime.click).toHaveBeenCalledWith({ target: "Record button", holdMs: 900 }, undefined);

		const dragResult = await dragTool.execute("tool-4", { fromTarget: "draft.txt", toTarget: "Trash" });
		expect((dragResult.content[0] as any).text).toContain("Dragged file to Trash");
			expect(dragResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
				confidence: 0.87,
			});

		const scrollResult = await scrollTool.execute("tool-5", { target: "Messages list", direction: "down" });
		expect((scrollResult.content[0] as any).text).toContain("Scrolled down");
			expect(scrollResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
				confidence: 0.8,
			});

		const typeResult = await typeTool.execute("tool-6", { target: "Subject field", value: "Quarterly update" });
		expect((typeResult.content[0] as any).text).toContain("Typed into Subject field");
		expect(runtime.type).toHaveBeenCalledWith({ target: "Subject field", value: "Quarterly update" }, undefined);
			expect(typeResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
				confidence: 0.88,
			});

		runtime.type.mockClear();
		const secretTypeResult = await typeTool.execute("tool-6b", {
			target: "Password field",
			secretEnvVar: "UNDERSTUDY_APPLE_ID_PASSWORD",
		});
		expect((secretTypeResult.content[0] as any).text).toContain("Typed into Subject field");
		expect(runtime.type).toHaveBeenCalledWith({
			target: "Password field",
			secretEnvVar: "UNDERSTUDY_APPLE_ID_PASSWORD",
		}, undefined);

		// gui_key — single key press
		const keyResult = await keyTool.execute("tool-7", { key: "Enter" });
		expect((keyResult.content[0] as any).text).toContain("Pressed Enter");
			expect(keyResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
				confidence: 1,
			});

		// gui_key — with modifiers
		runtime.key.mockClear();
		runtime.key.mockResolvedValueOnce({
			text: "Sent Command+K",
			status: {
				code: "action_sent",
				summary: "Command+K sent",
			},
			details: {
				grounding_method: "targetless",
			},
		});
		const hotkeyResult = await keyTool.execute("tool-8", { key: "k", modifiers: ["command"] });
		expect((hotkeyResult.content[0] as any).text).toContain("Sent Command+K");
			expect(hotkeyResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
			});
		expect(runtime.key).toHaveBeenCalledWith({ key: "k", modifiers: ["command"] }, undefined);

		// gui_observe returns screenshot image
		runtime.observe.mockClear();
		const observeScreenshotResult = await observeTool.execute("tool-9", { app: "Mail", captureMode: "window" });
		expect((observeScreenshotResult.content[0] as any).text).toContain("Observed Mail compose window");
		expect((observeScreenshotResult.content[1] as any).mimeType).toBe("image/png");
		expect(runtime.observe).toHaveBeenCalledWith({ app: "Mail", captureMode: "window" }, undefined);
			expect(observeScreenshotResult.details).toMatchObject({
				status: expect.objectContaining({ code: "observed" }),
			});

		const waitResult = await waitTool.execute("tool-10", { target: "Sent", state: "appear" });
		expect((waitResult.content[0] as any).text).toContain("Wait condition satisfied");
		expect(waitResult.details).toMatchObject({
			status: expect.objectContaining({ code: "condition_met" }),
		});

		// gui_move
		const moveResult = await moveTool.execute("tool-11", { x: 100, y: 200 });
		expect((moveResult.content[0] as any).text).toContain("Moved cursor to (100, 200)");
		expect(runtime.move).toHaveBeenCalledWith({ x: 100, y: 200 }, undefined);
	});

	it("lists the static GUI tool catalog", () => {
		expect(listGuiToolCatalog()).toEqual([
			expect.objectContaining({ name: "gui_observe", label: "GUI Observe" }),
			expect.objectContaining({ name: "gui_click", label: "GUI Click" }),
			expect.objectContaining({ name: "gui_drag", label: "GUI Drag" }),
			expect.objectContaining({ name: "gui_scroll", label: "GUI Scroll" }),
			expect.objectContaining({ name: "gui_type", label: "GUI Type" }),
			expect.objectContaining({ name: "gui_key", label: "GUI Key" }),
			expect.objectContaining({ name: "gui_wait", label: "GUI Wait" }),
			expect.objectContaining({ name: "gui_move", label: "GUI Move" }),
		]);
	});

	it("reuses the configured default gui runtime when one is provided", () => {
		const runtime = createRuntime() as any;
		setDefaultGuiRuntime(runtime);
		try {
			expect(createDefaultGuiRuntime()).toBe(runtime);
			expect(createGuiClickTool().execute).toBeTypeOf("function");
			expect(createGuiObserveTool().execute).toBeTypeOf("function");
			expect(createGuiKeyTool().execute).toBeTypeOf("function");
			expect(createGuiMoveTool().execute).toBeTypeOf("function");
		} finally {
			setDefaultGuiRuntime(undefined);
		}
	});

	it("preserves GUI action evidence", async () => {
		const runtime = {
			click: vi.fn().mockResolvedValue({
				text: 'Clicked "Send button".',
				status: {
					code: "action_sent",
					summary: "GUI click was sent.",
				},
				details: {
					grounding_method: "grounding",
					confidence: 0.93,
				},
				image: {
					data: Buffer.from("verified-image").toString("base64"),
					mimeType: "image/png",
					filename: "gui-screenshot.png",
				},
			}),
		};
		const clickTool = createGuiClickTool(runtime as any);

		const clickResult = await clickTool.execute("tool-verify", {
			target: "Send button",
		});

		expect(runtime.click).toHaveBeenCalledWith({
			target: "Send button",
		}, undefined);
		expect((clickResult.content[0] as any).text).toContain('Clicked "Send button".');
		expect((clickResult.content[1] as any).mimeType).toBe("image/png");
			expect(clickResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
			});
	});

	it("renders grounding metadata from the latest effective-mode field", async () => {
		const runtime = {
			click: vi.fn().mockResolvedValue({
				text: "Clicked Send button",
					status: {
						code: "action_sent",
						summary: "Triggered Send button",
					},
				details: {
					grounding_method: "grounding",
					grounding_mode_effective: "complex",
					grounding_selected_attempt: "validated",
					grounding_rounds_attempted: 2,
					grounding_total_ms: 321,
				},
			}),
		};
		const clickTool = createGuiClickTool(runtime as any);

		const clickResult = await clickTool.execute("tool-mode-field", { target: "Send button" });
		const textChunks = clickResult.content
			.filter((item): item is { type: "text"; text: string } => item.type === "text")
			.map((item) => item.text);

		expect(textChunks.some((text) => text.includes("[grounding] mode=complex"))).toBe(true);
		expect(textChunks.some((text) => text.includes("attempt=validated"))).toBe(true);
		expect(textChunks.some((text) => text.includes("rounds=2"))).toBe(true);
		expect(textChunks.some((text) => text.includes("total=321ms"))).toBe(true);
	});

	it("guides the model to name actionable and editable GUI surfaces precisely", () => {
		const runtime = createRuntime();
		const clickTool = createGuiClickTool(runtime as any);
		const typeTool = createGuiTypeTool(runtime as any);

		const clickTargetDescription = ((clickTool.parameters as any).properties?.target?.description ?? "") as string;
		const typeTargetDescription = ((typeTool.parameters as any).properties?.target?.description ?? "") as string;
		const clickGroundingMode = (clickTool.parameters as any).properties?.groundingMode;
		const clickGroundingOptions = Array.isArray(clickGroundingMode?.anyOf)
			? clickGroundingMode.anyOf.map((option: { const?: string }) => option.const).filter(Boolean)
			: clickGroundingMode?.enum;

		expect(clickTargetDescription).toContain("clickable/selectable control itself");
		expect(clickTargetDescription).toContain("not surrounding whitespace, wallpaper, or generic container chrome");
		expect(clickGroundingOptions).toEqual(["single", "complex"]);
		expect(clickGroundingMode?.description ?? "").toMatch(/"complex" when the visible target is ambiguous/);
		expect(typeTargetDescription).toContain("editable field/interior itself");
		expect(typeTargetDescription).toContain("reference placeholder text or existing content");
		expect(typeTargetDescription).toContain("not surrounding whitespace, wallpaper, or generic container chrome");
	});

	it("returns structured error text when the runtime throws", async () => {
		const runtime = {
			click: vi.fn().mockRejectedValue(new Error("GUI control permission denied")),
			observe: vi.fn().mockRejectedValue(new Error("Screen Recording permission denied")),
		};
		const clickTool = createGuiClickTool(runtime as any);
		const observeTool = createGuiObserveTool(runtime as any);

		const clickResult = await clickTool.execute("tool-11", { target: "Send button" });
		expect((clickResult.content[0] as any).text).toContain("GUI click failed: GUI control permission denied");
		expect(clickResult.details).toMatchObject({
			error: "GUI control permission denied",
			grounding_method: "grounding",
		});

		const observeResult = await observeTool.execute("tool-12", {});
		expect((observeResult.content[0] as any).text).toContain("GUI observe failed: Screen Recording permission denied");
		expect(observeResult.details).toMatchObject({
			error: "Screen Recording permission denied",
			grounding_method: "grounding",
		});
	});

	it("propagates aborts promptly for long-running gui runtime calls", async () => {
		let resolveObserve: ((value: unknown) => void) | undefined;
		const runtime = {
			observe: vi.fn(
				() =>
					new Promise((resolve) => {
						resolveObserve = resolve;
					}),
			),
		};
		const observeTool = createGuiObserveTool(runtime as any);
		const controller = new AbortController();

		const pending = observeTool.execute("tool-abort", { target: "Send button" }, controller.signal);
		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		resolveObserve?.({
			text: "Observed Send button",
				status: {
					code: "observed",
					summary: "GUI observation completed",
				},
			details: {
				grounding_method: "grounding",
			},
		});
	});

	it("does not surface mid-flight aborts for side-effecting gui actions", async () => {
		let resolveClick: ((value: unknown) => void) | undefined;
		const runtime = {
			click: vi.fn(
				() =>
					new Promise((resolve) => {
						resolveClick = resolve;
					}),
			),
		};
		const clickTool = createGuiClickTool(runtime as any);
		const controller = new AbortController();

		const pending = clickTool.execute("tool-click-abort", { target: "Send button" }, controller.signal);
		controller.abort();
		resolveClick?.({
			text: "Clicked Send button",
				status: {
					code: "action_sent",
					summary: "Triggered Send button",
				},
			details: {
				grounding_method: "grounding",
			},
		});

			await expect(pending).resolves.toMatchObject({
				details: {
					status: expect.objectContaining({ code: "action_sent" }),
				},
			});
	});

	it("preserves runtime method binding for gui tools", async () => {
		const runtime = {
			verificationLabel: "runtime-bound",
			async type(this: { verificationLabel: string }, params: { value: string }) {
				return {
					text: `Typed ${params.value} with ${this.verificationLabel}`,
						status: {
							code: "action_sent" as const,
							summary: "Bound runtime method executed",
						},
					details: {
						grounding_method: "grounding",
						binding: this.verificationLabel,
					},
				};
			},
		};
		const typeTool = createGuiTypeTool(runtime as any);

		const result = await typeTool.execute("tool-bound-type", { value: "hello" });

		expect((result.content[0] as any).text).toContain("runtime-bound");
			expect(result.details).toMatchObject({
				binding: "runtime-bound",
				status: expect.objectContaining({ code: "action_sent" }),
			});
	});

	it("rejects target-based gui usage when the runtime only exposes targetless tools", async () => {
		const runtime = {
			...createRuntime(),
			describeCapabilities: () => ({
				platformSupported: true,
				groundingAvailable: false,
				nativeHelperAvailable: true,
				screenCaptureAvailable: true,
				inputAvailable: true,
				enabledToolNames: ["gui_observe", "gui_scroll", "gui_type", "gui_key"],
				disabledToolNames: ["gui_click", "gui_drag", "gui_wait"],
				toolAvailability: {
					gui_observe: { enabled: true, targetlessOnly: true, reason: "targetless only" },
					gui_click: { enabled: false, reason: "grounding unavailable" },
					gui_drag: { enabled: false, reason: "grounding unavailable" },
					gui_scroll: { enabled: true, targetlessOnly: true, reason: "targetless only" },
					gui_type: { enabled: true, targetlessOnly: true, reason: "targetless only" },
					gui_key: { enabled: true },
					gui_wait: { enabled: false, reason: "grounding unavailable" },
					gui_move: { enabled: true },
				},
			}),
		};
		const observeTool = createGuiObserveTool(runtime as any);
		const clickTool = createGuiClickTool(runtime as any);
		const typeTool = createGuiTypeTool(runtime as any);
		const keyTool = createGuiKeyTool(runtime as any);

		const observeResult = await observeTool.execute("tool-observe-limited", { target: "Send button" });
		expect((observeResult.content[0] as any).text).toContain("GUI Observe unavailable");
		expect(runtime.observe).not.toHaveBeenCalled();

		const clickResult = await clickTool.execute("tool-click-limited", { target: "Send button" });
		expect((clickResult.content[0] as any).text).toContain("GUI Click unavailable");
		expect(runtime.click).not.toHaveBeenCalled();

		const typeResult = await typeTool.execute("tool-type-limited", { target: "Subject field", value: "hello" });
		expect((typeResult.content[0] as any).text).toContain("GUI Type unavailable");
		expect(runtime.type).not.toHaveBeenCalled();

		const keyResult = await keyTool.execute("tool-key-limited", {
			key: "Enter",
		});
		expect((keyResult.content[0] as any).text).toContain("Pressed Enter");
		expect(runtime.key).toHaveBeenCalled();
	});

	it("emits progress updates while a GUI action is running", async () => {
		vi.useFakeTimers();
		try {
			const runtime = {
				click: vi.fn(
					async () =>
						new Promise((resolve) => {
							setTimeout(() => {
								resolve({
									text: "Clicked Surge menu",
										status: {
											code: "action_sent",
											summary: "Opened Surge menu",
										},
									details: {
										grounding_method: "grounding",
									},
								});
							}, 7_000);
						}),
				),
			};
			const clickTool = createGuiClickTool(runtime as any);
			const onUpdate = vi.fn();

				const pending = clickTool.execute(
					"tool-progress",
					{
						app: "Surge",
						target: "top-left menu bar item labeled Surge",
					},
					undefined,
					onUpdate,
			);
			await vi.advanceTimersByTimeAsync(3_100);
			await vi.advanceTimersByTimeAsync(3_100);
			await vi.advanceTimersByTimeAsync(1_000);
			const result = await pending;

				expect(onUpdate).toHaveBeenCalled();
				expect((onUpdate.mock.calls[0]?.[0]?.content?.[0] as any)?.text).toContain("Resolving and executing the GUI action.");
				expect((result.content[0] as any).text).toContain("Clicked Surge menu");
			} finally {
				vi.useRealTimers();
			}
		});
});
