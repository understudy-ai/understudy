export function collectRepeatValue(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}
