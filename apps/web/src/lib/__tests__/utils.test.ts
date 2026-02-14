import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
	it("merges class names", () => {
		expect(cn("foo", "bar")).toBe("foo bar");
	});

	it("handles conditional classes", () => {
		expect(cn("foo", false && "bar")).toBe("foo");
	});

	it("deduplicates tailwind classes", () => {
		expect(cn("px-2", "px-4")).toBe("px-4");
	});

	it("handles empty inputs", () => {
		expect(cn()).toBe("");
	});
});
