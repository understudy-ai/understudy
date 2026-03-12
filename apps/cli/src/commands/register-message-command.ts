import type { Command } from "commander";
import { runMessageCommand } from "./message.js";
import { collectRepeatValue } from "./option-utils.js";

export function registerMessageCommand(program: Command): void {
	const messageCommand = program
		.command("message")
		.description("Send, search, and manage messages via the gateway")
		.action(() => messageCommand.help());

	messageCommand
		.command("send")
		.description("Send a message")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--to <recipient>", "Target recipient ID")
		.requiredOption("--text <text>", "Message text")
		.option("--thread <id>", "Thread ID")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "send" }));

	messageCommand
		.command("reply")
		.description("Reply to an existing message")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--to <recipient>", "Target recipient ID")
		.requiredOption("--reply-to <id>", "Message ID to reply to")
		.requiredOption("--text <text>", "Reply text")
		.option("--thread <id>", "Thread ID")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "reply" }));

	messageCommand
		.command("edit")
		.description("Edit an existing message")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--message-id <id>", "Target message ID")
		.requiredOption("--text <text>", "Updated message text")
		.option("--to <recipient>", "Recipient ID when required by channel")
		.option("--thread <id>", "Thread ID")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "edit" }));

	messageCommand
		.command("delete")
		.description("Delete an existing message")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--message-id <id>", "Target message ID")
		.option("--to <recipient>", "Recipient ID when required by channel")
		.option("--thread <id>", "Thread ID")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "delete" }));

	messageCommand
		.command("react")
		.description("React to a message")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--message-id <id>", "Target message ID")
		.requiredOption("--emoji <emoji>", "Reaction emoji")
		.option("--to <recipient>", "Recipient ID when required by channel")
		.option("--remove", "Remove reaction instead of adding one")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "react" }));

	messageCommand
		.command("attachment")
		.description("Send a message attachment")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--to <recipient>", "Target recipient ID")
		.requiredOption("--attachment <url>", "Attachment URL/path")
		.option("--attachment-type <type>", "Attachment type: image|file|audio|video")
		.option("--attachment-name <name>", "Attachment display name")
		.option("--attachment-mime-type <mime>", "Attachment MIME type")
		.option("--text <text>", "Optional message text")
		.option("--thread <id>", "Thread ID")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "sendattachment" }));

	messageCommand
		.command("search")
		.description("Search message history from active sessions")
		.requiredOption("--query <query>", "Search query")
		.option("--limit <n>", "Max result count", "20")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "search" }));

	messageCommand
		.command("poll")
		.description("Create a poll message")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--to <recipient>", "Target recipient ID")
		.requiredOption("--poll-question <text>", "Poll question")
		.option("--poll-option <text>", "Poll option (repeatable)", collectRepeatValue, [])
		.option("--poll-options <items>", "Poll options as comma-separated list")
		.option("--thread <id>", "Thread ID")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "poll" }));

	messageCommand
		.command("poll-vote")
		.description("Vote on a poll")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--to <recipient>", "Target recipient ID")
		.requiredOption("--poll-id <id>", "Poll ID")
		.requiredOption("--poll-choice <value>", "Choice to vote")
		.option("--thread <id>", "Thread ID")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "poll-vote" }));

	messageCommand
		.command("pin")
		.description("Pin a message")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--message-id <id>", "Target message ID")
		.option("--to <recipient>", "Recipient ID when required by channel")
		.option("--pin-reason <text>", "Reason for pin")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "pin" }));

	messageCommand
		.command("unpin")
		.description("Unpin a message")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--message-id <id>", "Target message ID")
		.option("--to <recipient>", "Recipient ID when required by channel")
		.option("--pin-reason <text>", "Reason for unpin")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "unpin" }));

	messageCommand
		.command("list-pins")
		.description("List pinned messages")
		.requiredOption("--channel <id>", "Target channel")
		.option("--to <recipient>", "Recipient ID when required by channel")
		.option("--thread <id>", "Thread ID")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "list-pins" }));

	messageCommand
		.command("permissions")
		.description("Update/query channel permissions")
		.requiredOption("--channel <id>", "Target channel")
		.option("--to <recipient>", "Recipient ID when required by channel")
		.option("--permissions-target <id>", "Permissions target ID")
		.option("--permissions <json>", "Permissions payload as JSON or string")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "permissions" }));

	messageCommand
		.command("thread-create")
		.description("Create a thread")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--to <recipient>", "Target recipient ID")
		.requiredOption("--thread-title <text>", "Thread title")
		.option("--thread-topic <text>", "Thread topic")
		.option("--thread-owner <id>", "Thread owner")
		.option("--text <text>", "Optional opening message")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "thread-create" }));

	messageCommand
		.command("thread-list")
		.description("List threads")
		.requiredOption("--channel <id>", "Target channel")
		.option("--to <recipient>", "Target recipient ID")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "thread-list" }));

	messageCommand
		.command("thread-reply")
		.description("Reply inside a thread")
		.requiredOption("--channel <id>", "Target channel")
		.requiredOption("--to <recipient>", "Target recipient ID")
		.requiredOption("--thread <id>", "Thread ID")
		.requiredOption("--text <text>", "Reply text")
		.option("--reply-to <id>", "Reply-to message ID")
		.option("--json", "Output as JSON")
		.option("-p, --port <port>", "Gateway port")
		.action((opts) => runMessageCommand({ ...opts, action: "thread-reply" }));
}
