import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installInteractiveChatMediaSupport } from "./chat-interactive-media.js";

const ONE_PIXEL_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9XYAAAAASUVORK5CYII=";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0, tempDirs.length)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("installInteractiveChatMediaSupport", () => {
	it("queues attachments and injects them into the next prompt", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "understudy-chat-interactive-"));
		tempDirs.push(tempDir);
		const textPath = join(tempDir, "notes.txt");
		const imagePath = join(tempDir, "pixel.png");
		writeFileSync(textPath, "alpha\nbeta", "utf8");
		writeFileSync(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));

		const originalPrompt = vi.fn().mockResolvedValue(undefined);
		const originalSubmit = vi.fn().mockResolvedValue(undefined);
		const showStatus = vi.fn();
		const showError = vi.fn();
		const setText = vi.fn();
		const interactive = {
			init: vi.fn().mockResolvedValue(undefined),
			defaultEditor: {
				onSubmit: originalSubmit,
				setText,
			},
			showStatus,
			showError,
		};
		const session = {
			prompt: originalPrompt,
		};

		await installInteractiveChatMediaSupport({
			interactive,
			session,
			cwd: tempDir,
		});

		await interactive.defaultEditor.onSubmit?.(`/attach ${textPath}`);
		await interactive.defaultEditor.onSubmit?.(`/attach ${imagePath}`);
		expect(showError).not.toHaveBeenCalled();
		expect(showStatus).toHaveBeenNthCalledWith(1, `Attached ${textPath} (1 pending).`);
		expect(showStatus).toHaveBeenNthCalledWith(2, `Attached ${imagePath} (2 pending).`);

		await session.prompt("describe both");

		expect(originalPrompt).toHaveBeenCalledWith(
			`<file name="${textPath}">\nalpha\nbeta\n</file>\n` +
				`<file name="${imagePath}"></file>\ndescribe both`,
			expect.objectContaining({
				images: [
					expect.objectContaining({
						type: "image",
						data: ONE_PIXEL_PNG_BASE64,
						mimeType: "image/png",
					}),
				],
			}),
		);
		await interactive.defaultEditor.onSubmit?.("/attachments");
		expect(showStatus).toHaveBeenLastCalledWith("No pending attachments.");
	});

	it("clears queued attachments without altering the next prompt", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "understudy-chat-interactive-"));
		tempDirs.push(tempDir);
		const textPath = join(tempDir, "notes.txt");
		writeFileSync(textPath, "alpha", "utf8");

		const originalPrompt = vi.fn().mockResolvedValue(undefined);
		const showStatus = vi.fn();
		const interactive = {
			init: vi.fn().mockResolvedValue(undefined),
			defaultEditor: {
				onSubmit: vi.fn().mockResolvedValue(undefined),
				setText: vi.fn(),
			},
			showStatus,
			showError: vi.fn(),
		};
		const session = {
			prompt: originalPrompt,
		};

		await installInteractiveChatMediaSupport({
			interactive,
			session,
			cwd: tempDir,
		});

		await interactive.defaultEditor.onSubmit?.(`/attach ${textPath}`);
		await interactive.defaultEditor.onSubmit?.("/detach");
		await session.prompt("plain message");

		expect(showStatus).toHaveBeenLastCalledWith("Cleared pending attachments.");
		expect(originalPrompt).toHaveBeenCalledWith("plain message", undefined);
	});

	it("passes removed legacy detach aliases through without clearing attachments", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "understudy-chat-interactive-"));
		tempDirs.push(tempDir);
		const textPath = join(tempDir, "notes.txt");
		writeFileSync(textPath, "alpha", "utf8");

		const originalPrompt = vi.fn().mockResolvedValue(undefined);
		const originalSubmit = vi.fn().mockResolvedValue(undefined);
		const showStatus = vi.fn();
		const interactive = {
			init: vi.fn().mockResolvedValue(undefined),
			defaultEditor: {
				onSubmit: originalSubmit,
				setText: vi.fn(),
			},
			showStatus,
			showError: vi.fn(),
		};
		const session = {
			prompt: originalPrompt,
		};

		await installInteractiveChatMediaSupport({
			interactive,
			session,
			cwd: tempDir,
		});

		await interactive.defaultEditor.onSubmit?.(`/attach ${textPath}`);
		await interactive.defaultEditor.onSubmit?.("/clear-attachments");
		await session.prompt("plain message");

		expect(originalSubmit).toHaveBeenCalledWith("/clear-attachments");
		expect(showStatus).not.toHaveBeenCalledWith("Cleared pending attachments.");
		expect(originalPrompt).toHaveBeenCalledWith(
			`<file name="${textPath}">\nalpha\n</file>\nplain message`,
			undefined,
		);
	});
});
