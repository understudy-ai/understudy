import type { ImageContent } from "@mariozechner/pi-ai";
import { mergeCliPromptText, prepareCliPromptInput } from "./cli-prompt-input.js";

interface InteractiveEditorLike {
	onSubmit?: (text: string) => Promise<void> | void;
	setText?: (text: string) => void;
}

interface InteractiveModeLike {
	init?: () => Promise<void>;
	defaultEditor?: InteractiveEditorLike;
	showStatus?: (text: string) => void;
	showError?: (text: string) => void;
}

interface PromptSessionLike {
	prompt?: (text: string, options?: Record<string, unknown>) => Promise<void>;
}

interface PendingPromptMedia {
	text: string;
	images: ImageContent[];
	labels: string[];
}

function isRemoteImageSource(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("file://");
}

function stripOuterQuotes(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === "\"" || first === "'") && first === last) {
			return trimmed.slice(1, -1).trim();
		}
	}
	return trimmed;
}

function readPendingImages(options?: Record<string, unknown>): ImageContent[] {
	const images = options?.images;
	return Array.isArray(images) ? images as ImageContent[] : [];
}

function buildPendingStatus(pending: PendingPromptMedia): string {
	if (pending.labels.length === 0) {
		return "No pending attachments.";
	}
	return `Pending attachments: ${pending.labels.join(", ")}`;
}

export async function installInteractiveChatMediaSupport(params: {
	interactive: InteractiveModeLike;
	session: PromptSessionLike;
	cwd: string;
}): Promise<void> {
	if (typeof params.session.prompt !== "function") {
		return;
	}
	const pending: PendingPromptMedia = {
		text: "",
		images: [],
		labels: [],
	};
	const originalPrompt = params.session.prompt.bind(params.session);
	params.session.prompt = async (text: string, options?: Record<string, unknown>) => {
		if (!pending.text && pending.images.length === 0) {
			await originalPrompt(text, options);
			return;
		}

		const mergedText = mergeCliPromptText(text, {
			text: pending.text,
			images: pending.images,
		});
		const mergedImages = [...readPendingImages(options), ...pending.images];
		pending.text = "";
		pending.images = [];
		pending.labels = [];
		await originalPrompt(
			mergedText,
			mergedImages.length > 0
				? { ...options, images: mergedImages }
				: options,
		);
	};

	if (!params.interactive.defaultEditor?.onSubmit && typeof params.interactive.init === "function") {
		await params.interactive.init();
	}

	const editor = params.interactive.defaultEditor;
	if (!editor?.onSubmit) {
		return;
	}
	const originalOnSubmit = editor.onSubmit.bind(editor);
	editor.onSubmit = async (text: string) => {
		const trimmed = text.trim();
		if (trimmed === "/attachments") {
			params.interactive.showStatus?.(buildPendingStatus(pending));
			editor.setText?.("");
			return;
		}
		if (trimmed === "/detach") {
			pending.text = "";
			pending.images = [];
			pending.labels = [];
			params.interactive.showStatus?.("Cleared pending attachments.");
			editor.setText?.("");
			return;
		}
		if (trimmed === "/attach" || trimmed.startsWith("/attach ")) {
			editor.setText?.("");
			const source = stripOuterQuotes(trimmed.slice("/attach".length));
			if (!source) {
				params.interactive.showError?.("Usage: /attach <path-or-url>");
				return;
			}
			try {
				const promptInput = await prepareCliPromptInput({
					cwd: params.cwd,
					files: isRemoteImageSource(source) ? [] : [source],
					images: isRemoteImageSource(source) ? [source] : [],
				});
				if (!promptInput.text && !(promptInput.images?.length)) {
					params.interactive.showError?.(`Nothing attached from ${source}`);
					return;
				}
				pending.text += promptInput.text;
				pending.images.push(...(promptInput.images ?? []));
				pending.labels.push(source);
				params.interactive.showStatus?.(`Attached ${source} (${pending.labels.length} pending).`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				params.interactive.showError?.(`Attach failed: ${message}`);
			}
			return;
		}
		await originalOnSubmit(text);
	};
}
