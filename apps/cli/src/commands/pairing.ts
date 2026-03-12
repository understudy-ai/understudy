/**
 * Pairing command: manage channel pairing codes.
 */

import { createRpcClient } from "../rpc-client.js";

interface PairingOptions {
	list?: boolean;
	approve?: string;
	reject?: string;
	channel?: string;
	port?: string;
}

export async function runPairingCommand(opts: PairingOptions = {}): Promise<void> {
	const client = createRpcClient({ port: opts.port ? parseInt(opts.port, 10) : undefined });

	try {
		if (opts.approve) {
			const channelId = opts.channel ?? "web";
			const result = await client.call<any>("pairing.approve", {
				code: opts.approve,
				channelId,
				senderId: "cli",
			});
			console.log(result.approved ? `Approved pairing code: ${opts.approve}` : `Invalid pairing code: ${opts.approve}`);
			return;
		}

		if (opts.reject) {
			const result = await client.call<any>("pairing.reject", {
				code: opts.reject,
				channelId: opts.channel,
			});
			console.log(
				result.rejected
					? `Rejected pairing code: ${opts.reject}`
					: `Pairing code not found or already expired: ${opts.reject}`,
			);
			return;
		}

		// Default: request a new code
		const channelId = opts.channel ?? "web";
		const result = await client.call<any>("pairing.request", { channelId });
		console.log(`Pairing code for ${channelId}: ${result.code}`);
		console.log("Share this code with the user to authorize their access.");
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
