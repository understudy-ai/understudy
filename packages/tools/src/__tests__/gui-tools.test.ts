import { describe, expect, it, vi } from "vitest";
import {
	createDefaultGuiRuntime,
	createGuiClickTool,
	createGuiClickAndHoldTool,
	createGuiDoubleClickTool,
	createGuiDragTool,
	createGuiHoverTool,
	createGuiHotkeyTool,
	createGuiKeypressTool,
	createGuiReadTool,
	createGuiRightClickTool,
	createGuiScreenshotTool,
	createGuiScrollTool,
	createGuiTypeTool,
	createGuiWaitTool,
	setDefaultGuiRuntime,
} from "../gui-tools.js";

function createRuntime() {
	return {
		read: vi.fn().mockResolvedValue({
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
		rightClick: vi.fn().mockResolvedValue({
			text: "Right-clicked Send button",
			status: {
				code: "action_sent",
				summary: "Opened context menu",
			},
			details: {
				grounding_method: "grounding",
				confidence: 0.9,
			},
		}),
		doubleClick: vi.fn().mockResolvedValue({
			text: "Double-clicked Downloads folder",
			status: {
				code: "action_sent",
				summary: "Opened Downloads folder",
			},
			details: {
				grounding_method: "grounding",
				confidence: 0.9,
			},
		}),
		hover: vi.fn().mockResolvedValue({
			text: "Hovered over Preview card",
			status: {
				code: "action_sent",
				summary: "Hovered preview card",
			},
			details: {
				grounding_method: "grounding",
				confidence: 0.89,
				settle_ms: 240,
			},
		}),
		clickAndHold: vi.fn().mockResolvedValue({
			text: "Clicked and held Record button",
			status: {
				code: "action_sent",
				summary: "Pressed and held record button",
			},
			details: {
				grounding_method: "grounding",
				confidence: 0.86,
				hold_duration_ms: 900,
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
		keypress: vi.fn().mockResolvedValue({
			text: "Pressed Enter",
			status: {
				code: "action_sent",
				summary: "Pressed Enter",
			},
			details: {
				grounding_method: "visual",
				confidence: 1,
			},
		}),
		hotkey: vi.fn().mockResolvedValue({
			text: "Sent Command+K",
			status: {
				code: "action_sent",
				summary: "Command+K sent",
			},
			details: {
				grounding_method: "visual",
			},
		}),
		screenshot: vi.fn().mockResolvedValue({
			text: "Captured GUI screenshot",
			status: {
				code: "observed",
				summary: "GUI screenshot captured",
			},
			details: {
				grounding_method: "screenshot",
				mimeType: "image/png",
			},
			image: {
				data: Buffer.from("png-bytes").toString("base64"),
				mimeType: "image/png",
				filename: "gui-screenshot.png",
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
	};
}

describe("gui tool wrappers", () => {
	it("exposes first-class gui tools and forwards structured runtime results", async () => {
		const runtime = createRuntime();
		const readTool = createGuiReadTool(runtime as any);
		const clickTool = createGuiClickTool(runtime as any);
		const rightClickTool = createGuiRightClickTool(runtime as any);
		const doubleClickTool = createGuiDoubleClickTool(runtime as any);
		const hoverTool = createGuiHoverTool(runtime as any);
		const clickAndHoldTool = createGuiClickAndHoldTool(runtime as any);
		const dragTool = createGuiDragTool(runtime as any);
		const scrollTool = createGuiScrollTool(runtime as any);
		const typeTool = createGuiTypeTool(runtime as any);
		const keypressTool = createGuiKeypressTool(runtime as any);
		const hotkeyTool = createGuiHotkeyTool(runtime as any);
		const screenshotTool = createGuiScreenshotTool(runtime as any);
		const waitTool = createGuiWaitTool(runtime as any);

		expect(readTool.name).toBe("gui_read");
		expect(clickTool.name).toBe("gui_click");
		expect(rightClickTool.name).toBe("gui_right_click");
		expect(doubleClickTool.name).toBe("gui_double_click");
		expect(hoverTool.name).toBe("gui_hover");
		expect(clickAndHoldTool.name).toBe("gui_click_and_hold");
		expect(dragTool.name).toBe("gui_drag");
		expect(scrollTool.name).toBe("gui_scroll");
		expect(typeTool.name).toBe("gui_type");
		expect(keypressTool.name).toBe("gui_keypress");
		expect(hotkeyTool.name).toBe("gui_hotkey");
		expect(screenshotTool.name).toBe("gui_screenshot");
		expect(waitTool.name).toBe("gui_wait");

		const readResult = await readTool.execute("tool-1", { app: "Mail", target: "Send button" });
		expect((readResult.content[0] as any).text).toContain("Observed Mail compose window");
			expect(readResult.details).toMatchObject({
				observation: expect.objectContaining({ appName: "Mail", method: "screenshot" }),
				resolution: expect.objectContaining({ reason: "Matched Send button" }),
				status: expect.objectContaining({ code: "observed" }),
				grounding_method: "grounding",
			});

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

		const rightClickResult = await rightClickTool.execute("tool-2b", { target: "Send button" });
		expect((rightClickResult.content[0] as any).text).toContain("Right-clicked Send button");
			expect(rightClickResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
				confidence: 0.9,
			});

		const doubleClickResult = await doubleClickTool.execute("tool-3", { target: "Downloads folder" });
		expect((doubleClickResult.content[0] as any).text).toContain("Double-clicked Downloads folder");
			expect(doubleClickResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
				confidence: 0.9,
			});

		const hoverResult = await hoverTool.execute("tool-3b", {
			target: "Preview card",
			settleMs: 240,
		});
		expect((hoverResult.content[0] as any).text).toContain("Hovered over Preview card");
			expect(hoverResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
				confidence: 0.89,
				settle_ms: 240,
			});

		const clickAndHoldResult = await clickAndHoldTool.execute("tool-3c", {
			target: "Record button",
			holdDurationMs: 900,
		});
		expect((clickAndHoldResult.content[0] as any).text).toContain("Clicked and held Record button");
			expect(clickAndHoldResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
				confidence: 0.86,
				hold_duration_ms: 900,
			});

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
			expect(typeResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
				confidence: 0.88,
			});

		const keypressResult = await keypressTool.execute("tool-7", { key: "Enter" });
		expect((keypressResult.content[0] as any).text).toContain("Pressed Enter");
			expect(keypressResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
				confidence: 1,
			});

		const hotkeyResult = await hotkeyTool.execute("tool-8", { key: "k", modifiers: ["command"] });
		expect((hotkeyResult.content[0] as any).text).toContain("Sent Command+K");
			expect(hotkeyResult.details).toMatchObject({
				status: expect.objectContaining({ code: "action_sent" }),
			});

		const screenshotResult = await screenshotTool.execute("tool-9", { app: "Mail", captureMode: "window" });
		expect((screenshotResult.content[0] as any).text).toContain("Captured GUI screenshot");
		expect((screenshotResult.content[1] as any).mimeType).toBe("image/png");
		expect(runtime.screenshot).toHaveBeenCalledWith({ app: "Mail", captureMode: "window" }, undefined);
			expect(screenshotResult.details).toMatchObject({
				status: expect.objectContaining({ code: "observed" }),
				mimeType: "image/png",
			});

		const waitResult = await waitTool.execute("tool-10", { target: "Sent", state: "appear" });
		expect((waitResult.content[0] as any).text).toContain("Wait condition satisfied");
		expect(waitResult.details).toMatchObject({
			status: expect.objectContaining({ code: "condition_met" }),
		});
	});

	it("reuses the configured default gui runtime when one is provided", () => {
		const runtime = createRuntime() as any;
		setDefaultGuiRuntime(runtime);
		try {
			expect(createDefaultGuiRuntime()).toBe(runtime);
			expect(createGuiClickTool().execute).toBeTypeOf("function");
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
			screenshot: vi.fn().mockRejectedValue(new Error("Screen Recording permission denied")),
		};
		const clickTool = createGuiClickTool(runtime as any);
		const screenshotTool = createGuiScreenshotTool(runtime as any);

		const clickResult = await clickTool.execute("tool-11", { target: "Send button" });
		expect((clickResult.content[0] as any).text).toContain("GUI click failed: GUI control permission denied");
		expect(clickResult.details).toMatchObject({
			error: "GUI control permission denied",
			grounding_method: "grounding",
		});

		const screenshotResult = await screenshotTool.execute("tool-12", {});
		expect((screenshotResult.content[0] as any).text).toContain("GUI screenshot failed: Screen Recording permission denied");
		expect(screenshotResult.details).toMatchObject({
			error: "Screen Recording permission denied",
			grounding_method: "screenshot",
		});
	});

	it("propagates aborts promptly for long-running gui runtime calls", async () => {
		let resolveRead: ((value: unknown) => void) | undefined;
		const runtime = {
			read: vi.fn(
				() =>
					new Promise((resolve) => {
						resolveRead = resolve;
					}),
			),
		};
		const readTool = createGuiReadTool(runtime as any);
		const controller = new AbortController();

		const pending = readTool.execute("tool-abort", { target: "Send button" }, controller.signal);
		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		resolveRead?.({
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
				enabledToolNames: ["gui_read", "gui_scroll", "gui_type", "gui_keypress", "gui_hotkey", "gui_screenshot"],
				disabledToolNames: ["gui_click", "gui_right_click", "gui_double_click", "gui_hover", "gui_click_and_hold", "gui_drag", "gui_wait"],
				toolAvailability: {
					gui_read: { enabled: true, targetlessOnly: true, reason: "targetless only" },
					gui_click: { enabled: false, reason: "grounding unavailable" },
					gui_right_click: { enabled: false, reason: "grounding unavailable" },
					gui_double_click: { enabled: false, reason: "grounding unavailable" },
					gui_hover: { enabled: false, reason: "grounding unavailable" },
					gui_click_and_hold: { enabled: false, reason: "grounding unavailable" },
					gui_drag: { enabled: false, reason: "grounding unavailable" },
					gui_scroll: { enabled: true, targetlessOnly: true, reason: "targetless only" },
					gui_type: { enabled: true, targetlessOnly: true, reason: "targetless only" },
					gui_keypress: { enabled: true },
					gui_hotkey: { enabled: true },
					gui_screenshot: { enabled: true, targetlessOnly: true, reason: "targetless only" },
					gui_wait: { enabled: false, reason: "grounding unavailable" },
				},
			}),
		};
		const readTool = createGuiReadTool(runtime as any);
		const clickTool = createGuiClickTool(runtime as any);
		const typeTool = createGuiTypeTool(runtime as any);
		const keypressTool = createGuiKeypressTool(runtime as any);

		const readResult = await readTool.execute("tool-read-limited", { target: "Send button" });
		expect((readResult.content[0] as any).text).toContain("GUI Read unavailable");
		expect(runtime.read).not.toHaveBeenCalled();

		const clickResult = await clickTool.execute("tool-click-limited", { target: "Send button" });
		expect((clickResult.content[0] as any).text).toContain("GUI Click unavailable");
		expect(runtime.click).not.toHaveBeenCalled();

		const typeResult = await typeTool.execute("tool-type-limited", { target: "Subject field", value: "hello" });
		expect((typeResult.content[0] as any).text).toContain("GUI Type unavailable");
		expect(runtime.type).not.toHaveBeenCalled();

		const keypressResult = await keypressTool.execute("tool-keypress-limited", {
			key: "Enter",
		});
		expect((keypressResult.content[0] as any).text).toContain("Pressed Enter");
		expect(runtime.keypress).toHaveBeenCalled();
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
