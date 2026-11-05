// Who may sign in: the GitHub ids listed in config/allowed-users.json (committed, reviewed like any other code).
// Ids are used, not logins, because logins can be renamed and then claimed by someone else.
// Fails closed: an empty list means nobody can sign in.
import allowedUsers from "../config/allowed-users.json";

export interface AllowedUser {
	github_id: number;
	/** A label for humans reading the file. Never used for the check. */
	login?: string;
}

export function isAllowedGithubId(githubId: number | string, users: AllowedUser[] = allowedUsers as AllowedUser[]): boolean {
	const id = String(githubId);
	if (!/^\d+$/.test(id)) return false;
	return users.some((u) => Number.isSafeInteger(u.github_id) && String(u.github_id) === id);
}
