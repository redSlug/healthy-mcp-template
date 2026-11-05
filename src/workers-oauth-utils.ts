// OAuth helpers for the sign-in flow: CSRF token, state bound to the browser, "already approved" cookie, and the consent page.
import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";

/** An OAuth error that becomes a JSON error response. */
export class OAuthError extends Error {
	constructor(
		public code: string,
		public description: string,
		public statusCode = 400,
	) {
		super(description);
		this.name = "OAuthError";
	}

	toResponse(): Response {
		return Response.json({ error: this.code, error_description: this.description }, { status: this.statusCode });
	}
}

const CSRF_COOKIE = "__Host-CSRF_TOKEN";
const STATE_COOKIE = "__Host-CONSENTED_STATE";
const APPROVED_COOKIE = "__Host-APPROVED_CLIENTS";

const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
const clearCookie = (name: string) => cookie(name, "", 0);

function readCookie(request: Request, name: string): string | null {
	const found = (request.headers.get("Cookie") ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
	return found ? found.substring(name.length + 1) : null;
}

const toHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (text: string) => toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** Escapes text for safe use in HTML. */
function sanitizeText(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/** Only well-formed http(s) URLs pass (no javascript:, data:, control characters). Returns "" otherwise. Escape the result before putting it in HTML. */
function sanitizeUrl(url: string): string {
	const u = url.trim();
	if (/[\u0000-\u001f\u007f-\u009f]/.test(u)) return "";
	try {
		return ["https:", "http:"].includes(new URL(u).protocol) ? u : "";
	} catch {
		return "";
	}
}

// --- CSRF token for the consent form (one use) ---

export function generateCSRFProtection() {
	const token = crypto.randomUUID();
	return { token, setCookie: cookie(CSRF_COOKIE, token, 600) };
}

export function validateCSRFToken(formData: FormData, request: Request) {
	const fromForm = formData.get("csrf_token");
	if (!fromForm || typeof fromForm !== "string") throw new OAuthError("invalid_request", "Missing CSRF token in form data");
	const fromCookie = readCookie(request, CSRF_COOKIE);
	if (!fromCookie) throw new OAuthError("invalid_request", "Missing CSRF token cookie");
	if (fromForm !== fromCookie) throw new OAuthError("invalid_request", "CSRF token mismatch");
	return { clearCookie: clearCookie(CSRF_COOKIE) };
}

// --- OAuth state: stored in KV, and tied to the browser that approved it by a cookie holding its hash ---

export async function createOAuthState(oauthReqInfo: AuthRequest, kv: KVNamespace, ttlSeconds = 600) {
	const stateToken = crypto.randomUUID();
	await kv.put(`oauth:state:${stateToken}`, JSON.stringify(oauthReqInfo), { expirationTtl: ttlSeconds });
	return { stateToken };
}

/** The cookie holds a hash of the state, so a leaked state value alone cannot be replayed from another browser. */
export async function bindStateToSession(stateToken: string) {
	return { setCookie: cookie(STATE_COOKIE, await sha256Hex(stateToken), 600) };
}

/** Checks the state exists in KV (we made it) and matches this browser's cookie (this browser approved it). One use. */
export async function validateOAuthState(request: Request, kv: KVNamespace) {
	const state = new URL(request.url).searchParams.get("state");
	if (!state) throw new OAuthError("invalid_request", "Missing state parameter");

	const stored = await kv.get(`oauth:state:${state}`);
	if (!stored) throw new OAuthError("invalid_request", "Invalid or expired state");

	const boundHash = readCookie(request, STATE_COOKIE);
	if (!boundHash) throw new OAuthError("invalid_request", "Missing session binding cookie - authorization flow must be restarted");
	if ((await sha256Hex(state)) !== boundHash) throw new OAuthError("invalid_request", "State token does not match session - possible CSRF attack detected");

	let oauthReqInfo: AuthRequest;
	try {
		oauthReqInfo = JSON.parse(stored) as AuthRequest;
	} catch {
		throw new OAuthError("server_error", "Invalid state data", 500);
	}
	await kv.delete(`oauth:state:${state}`);
	return { oauthReqInfo, clearCookie: clearCookie(STATE_COOKIE) };
}

// --- "Already approved" cookie: a signed list of client ids ---

const hmacKey = (secret: string) => {
	if (!secret) throw new Error("cookieSecret is required for signing cookies");
	return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
};
const sign = async (data: string, secret: string) => toHex(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(data)));

async function readApprovedClients(request: Request, secret: string): Promise<string[] | null> {
	const parts = readCookie(request, APPROVED_COOKIE)?.split(".");
	if (parts?.length !== 2) return null;
	const [signatureHex, base64Payload] = parts;
	try {
		const payload = atob(base64Payload); // not valid base64 throws: treated as not approved
		const signature = new Uint8Array(signatureHex.match(/.{1,2}/g)!.map((b) => Number.parseInt(b, 16)));
		if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret), signature, new TextEncoder().encode(payload)))) return null;
		const list = JSON.parse(payload);
		return Array.isArray(list) && list.every((x) => typeof x === "string") ? list : null;
	} catch {
		return null;
	}
}

export async function isClientApproved(request: Request, clientId: string, cookieSecret: string): Promise<boolean> {
	return (await readApprovedClients(request, cookieSecret))?.includes(clientId) ?? false;
}

/** Returns the Set-Cookie value with this client added to the approved list (30 days). */
export async function addApprovedClient(request: Request, clientId: string, cookieSecret: string): Promise<string> {
	const clients = Array.from(new Set([...((await readApprovedClients(request, cookieSecret)) ?? []), clientId]));
	const payload = JSON.stringify(clients);
	return cookie(APPROVED_COOKIE, `${await sign(payload, cookieSecret)}.${btoa(payload)}`, 30 * 24 * 3600);
}

// --- The consent page ---

interface ApprovalDialogOptions {
	client: ClientInfo | null;
	server: { name: string; description?: string };
	/** Passed through the form and returned when the user approves. */
	state: Record<string, any>;
	csrfToken: string;
	setCookie: string;
}

const STYLE = `
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#333;background:#f9fafb;margin:0}
.container{max-width:600px;margin:2rem auto;padding:1rem}
.precard{padding:2rem;text-align:center}
.card{background:#fff;border-radius:8px;box-shadow:0 8px 36px 8px rgba(0,0,0,.1);padding:2rem}
.title{margin:0;font-size:1.3rem;font-weight:400}
.alert{font-size:1.5rem;font-weight:400;margin:1rem 0;text-align:center}
.description{color:#555}
.client-info{border:1px solid #e5e7eb;border-radius:6px;padding:1rem 1rem .5rem;margin-bottom:1.5rem}
.row{display:flex;margin-bottom:.5rem;align-items:baseline}
.label{font-weight:500;min-width:120px}
.value{font-family:SFMono-Regular,Menlo,Monaco,Consolas,monospace;word-break:break-all}
.value a{color:inherit;text-decoration:underline}
.small{font-size:.8em}
.actions{display:flex;justify-content:flex-end;gap:1rem;margin-top:2rem}
.button{padding:.75rem 1.5rem;border-radius:6px;font-weight:500;cursor:pointer;border:none;font-size:1rem}
.primary{background:#0070f3;color:#fff}
.secondary{background:transparent;border:1px solid #e5e7eb;color:#333}
@media (max-width:640px){.container{margin:1rem auto;padding:.5rem}.card{padding:1.5rem}.row,.actions{flex-direction:column}.label{min-width:unset;margin-bottom:.25rem}.button{width:100%}}`;

export function renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response {
	const { client, server, state, csrfToken, setCookie } = options;
	const serverName = sanitizeText(server.name);
	const clientName = client?.clientName ? sanitizeText(client.clientName) : "Unknown MCP Client";
	const safeUrl = (u?: string) => (u ? sanitizeText(sanitizeUrl(u)) : "");

	const row = (label: string, value: string, small = false) => (value ? `<div class="row"><div class="label">${label}</div><div class="value${small ? " small" : ""}">${value}</div></div>` : "");
	const link = (u: string) => (u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>` : "");
	const redirects = (client?.redirectUris ?? []).map(safeUrl).filter(Boolean).map((u) => `<div>${u}</div>`).join("");

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${clientName} | Authorization Request</title>
<style>${STYLE}</style>
</head>
<body>
<div class="container">
<div class="precard">
<h1 class="title"><strong>${serverName}</strong></h1>
${server.description ? `<p class="description">${sanitizeText(server.description)}</p>` : ""}
</div>
<div class="card">
<h2 class="alert"><strong>${clientName}</strong> is requesting access</h2>
<div class="client-info">
${row("Name:", clientName)}
${row("Website:", link(safeUrl(client?.clientUri)), true)}
${row("Privacy Policy:", link(safeUrl(client?.policyUri)))}
${row("Terms of Service:", link(safeUrl(client?.tosUri)))}
${row("Redirect URIs:", redirects, true)}
${row("Contact:", client?.contacts?.length ? sanitizeText(client.contacts.join(", ")) : "")}
</div>
<p>This MCP Client is requesting to be authorized on ${serverName}. If you approve, you will be redirected to complete authentication.</p>
<p><strong>If you approve, this app can read, add, edit and archive your food, water and workout data.</strong></p>
<form method="post" action="${new URL(request.url).pathname}">
<input type="hidden" name="state" value="${btoa(JSON.stringify(state))}">
<input type="hidden" name="csrf_token" value="${csrfToken}">
<div class="actions">
<button type="button" class="button secondary" onclick="window.history.back()">Cancel</button>
<button type="submit" class="button primary">Approve</button>
</div>
</form>
</div>
</div>
</body>
</html>`;

	return new Response(html, {
		headers: {
			"Content-Security-Policy": "frame-ancestors 'none'",
			"Content-Type": "text/html; charset=utf-8",
			"Set-Cookie": setCookie,
			"X-Frame-Options": "DENY",
		},
	});
}
