// update_settings: the user's time zone and daily targets. "Today" and every logged date follow the time zone.
import { getTargets, setTargets, setTimeZone, type Targets, type UserId } from "../data";
import { isValidTimeZone } from "../time";
import { fail, userTimeZone } from "./common";

export interface UpdateSettingsInput { time_zone?: string; targets?: Targets }

export async function updateSettings(db: D1Database, userId: UserId, input: UpdateSettingsInput) {
	if (input.time_zone === undefined && !input.targets) throw fail("Send a time_zone, targets, or both.", "settings");
	if (input.time_zone !== undefined) {
		if (!isValidTimeZone(input.time_zone)) throw fail("time_zone must be an IANA name such as America/Chicago or Europe/London.", "time_zone");
		await setTimeZone(db, userId, input.time_zone);
	}
	if (input.targets) await setTargets(db, userId, input.targets); // fields not sent keep their value
	const targets = Object.fromEntries(Object.entries((await getTargets(db, userId)) ?? {}).filter(([, v]) => v != null));
	return { time_zone: await userTimeZone(db, userId), targets };
}
