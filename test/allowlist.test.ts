import { describe, expect, it } from "vitest";
import allowedUsers from "../config/allowed-users.json";
import { isAllowedGithubId } from "../src/allowlist";

const users = [{ github_id: 1001, login: "a" }, { github_id: 1002 }];

describe("isAllowedGithubId", () => {
	it("allows listed ids, as numbers or strings", () => {
		expect(isAllowedGithubId(1002, users)).toBe(true);
		expect(isAllowedGithubId("1001", users)).toBe(true);
	});
	it("refuses ids that are not listed, including partial matches and logins", () => {
		expect(isAllowedGithubId(1003, users)).toBe(false);
		expect(isAllowedGithubId(100, users)).toBe(false);
		expect(isAllowedGithubId(11001, users)).toBe(false);
		expect(isAllowedGithubId("a", users)).toBe(false);
	});
	it("fails closed when the list is empty or holds junk", () => {
		expect(isAllowedGithubId(1001, [])).toBe(false);
		expect(isAllowedGithubId(1001, [{ github_id: "1001" as any }, { github_id: NaN }])).toBe(false);
	});
});

describe("config/allowed-users.json", () => {
	it("is a list of entries with unique numeric github_id", () => {
		expect(Array.isArray(allowedUsers)).toBe(true);
		const ids = (allowedUsers as { github_id: number }[]).map((u) => u.github_id);
		for (const id of ids) expect(Number.isSafeInteger(id) && id > 0).toBe(true);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
