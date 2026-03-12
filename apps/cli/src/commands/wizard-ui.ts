import {
	cancel,
	confirm,
	intro,
	isCancel,
	multiselect,
	note,
	outro,
	select,
	spinner,
	text,
	type Option,
} from "@clack/prompts";

export interface WizardChoiceOption<T = string> {
	value: T;
	label: string;
	hint?: string;
}

export interface WizardProgress {
	update(message: string): void;
	stop(message?: string): void;
}

export interface WizardUi {
	intro(title: string): Promise<void>;
	outro(message: string): Promise<void>;
	note(message: string, title?: string): Promise<void>;
	select<T>(params: {
		message: string;
		options: Array<WizardChoiceOption<T>>;
		initialValue?: T;
	}): Promise<T>;
	multiselect<T>(params: {
		message: string;
		options: Array<WizardChoiceOption<T>>;
		initialValues?: T[];
		required?: boolean;
	}): Promise<T[]>;
	text(params: {
		message: string;
		initialValue?: string;
		placeholder?: string;
		validate?: (value: string) => string | undefined;
	}): Promise<string>;
	confirm(params: {
		message: string;
		initialValue?: boolean;
	}): Promise<boolean>;
	progress(label: string): WizardProgress;
}

export class WizardCancelledError extends Error {
	constructor(message = "wizard cancelled") {
		super(message);
		this.name = "WizardCancelledError";
	}
}

function guardCancel<T>(value: T | symbol): T {
	if (isCancel(value)) {
		cancel("Setup cancelled.");
		throw new WizardCancelledError();
	}
	return value;
}

function mapOptions<T>(options: Array<WizardChoiceOption<T>>): Option<T>[] {
	return options.map((option) => (
		option.hint === undefined
			? { value: option.value, label: option.label }
			: { value: option.value, label: option.label, hint: option.hint }
	)) as Option<T>[];
}

export function createWizardUi(): WizardUi {
	return {
		intro: async (title) => {
			intro(title);
		},
		outro: async (message) => {
			outro(message);
		},
		note: async (message, title) => {
			note(message, title);
		},
		select: async (params) =>
			guardCancel(await select({
				message: params.message,
				options: mapOptions(params.options),
				initialValue: params.initialValue,
			})),
		multiselect: async (params) =>
			guardCancel(await multiselect({
				message: params.message,
				options: mapOptions(params.options),
				initialValues: params.initialValues,
				required: params.required,
			})),
		text: async (params) =>
			guardCancel(await text({
				message: params.message,
				initialValue: params.initialValue,
				placeholder: params.placeholder,
				validate: params.validate
					? (value) => params.validate?.(value ?? "")
					: undefined,
			})),
		confirm: async (params) =>
			guardCancel(await confirm({
				message: params.message,
				initialValue: params.initialValue,
			})),
		progress: (label) => {
			const indicator = spinner();
			indicator.start(label);
			return {
				update(message) {
					indicator.message(message);
				},
				stop(message) {
					indicator.stop(message);
				},
			};
		},
	};
}
