export const GUI_TOOL_NAMES = [
	"gui_observe",
	"gui_click",
	"gui_drag",
	"gui_scroll",
	"gui_type",
	"gui_key",
	"gui_wait",
	"gui_move",
] as const;

export type GuiToolName = (typeof GUI_TOOL_NAMES)[number];
