// Time zone helpers. A log's `date` is the user's LOCAL calendar day, derived from `eaten_at`.

export function isValidTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

export function isValidDate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** The local calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(instant: Date, tz: string): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function offsetMs(tz: string, utcMs: number): number {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
			hour: "2-digit", minute: "2-digit", second: "2-digit",
		}).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
	);
	const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
	return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `tz` reads `date` `hour`:`minute`. */
export function localToUtc(date: string, hour: number, minute: number, tz: string): Date {
	const [y, m, d] = date.split("-").map(Number);
	const guess = Date.UTC(y, m - 1, d, hour, minute);
	const first = guess - offsetMs(tz, guess);
	return new Date(guess - offsetMs(tz, first));
}

/** Noon on a local day, as an ISO UTC string. Used when a log has a date but no time. */
export const localNoonUtc = (date: string, tz: string) => localToUtc(date, 12, 0, tz).toISOString();
