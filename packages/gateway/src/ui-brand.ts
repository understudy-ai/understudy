const UNDERSTUDY_BRAND_ICON_SVG =
	"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
	"<defs>" +
	"<linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='#0a0f1e'/><stop offset='100%' stop-color='#111c30'/></linearGradient>" +
	"<linearGradient id='u' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='#fef9ee'/><stop offset='100%' stop-color='#64748b'/></linearGradient>" +
	"<radialGradient id='glow' cx='0.5' cy='0.06' r='0.2'><stop offset='0%' stop-color='#fbbf24' stop-opacity='0.5'/><stop offset='100%' stop-color='#fbbf24' stop-opacity='0'/></radialGradient>" +
	"</defs>" +
	"<rect width='64' height='64' rx='15' fill='url(#bg)'/>" +
	"<path d='M32 6 L14 56 L50 56 Z' fill='#fbbf24' opacity='0.07'/>" +
	"<path d='M32 6 L20 56 L44 56 Z' fill='#fbbf24' opacity='0.05'/>" +
	"<rect width='64' height='64' rx='15' fill='url(#glow)'/>" +
	"<path d='M21 18 v16 c0 9 5 14 11 14s11-5 11-14V18h-6v15c0 5-2 8-5 8s-5-3-5-8V18z' fill='url(#u)'/>" +
	"<circle cx='32' cy='5' r='4.5' fill='#fbbf24'/>" +
	"<circle cx='32' cy='5' r='8' fill='#fbbf24' opacity='0.1'/>" +
	"<rect x='10' y='55' width='44' height='2.5' rx='1.25' fill='#fbbf24' opacity='0.35'/>" +
	"</svg>";

export function understudyBrandIconDataUrl(): string {
	return `data:image/svg+xml,${encodeURIComponent(UNDERSTUDY_BRAND_ICON_SVG)}`;
}
