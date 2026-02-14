/**
 * Streamdown Security Configuration
 *
 * Provides hardened rehype plugin configuration for all Streamdown usages.
 * Overrides Streamdown's permissive defaults (wildcard protocols/prefixes)
 * with strict allow-lists to mitigate XSS via markdown rendering.
 *
 * Security layers:
 * 1. rehype-raw: Parses raw HTML in markdown into the AST
 * 2. rehype-sanitize: Strips disallowed tags/attributes (GitHub-style defaults)
 * 3. rehype-harden: Enforces URL protocol and prefix allow-lists for links/images
 *
 * @see https://linear.app/osschat/issue/OSS-40
 */

import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { harden } from "rehype-harden";
import { defaultSchema } from "hast-util-sanitize";
import type { PluggableList } from "unified";

/**
 * Strict protocol allow-list for links.
 * Only http: and https: are permitted; javascript:, data:, vbscript:, file:, etc. are blocked.
 */
const ALLOWED_PROTOCOLS = ["http:", "https:"];

/**
 * Strict protocol allow-list for rehype-sanitize.
 * Extends the default schema to restrict href protocols to http/https/mailto only.
 */
const sanitizeSchema = {
	...defaultSchema,
	protocols: {
		...defaultSchema.protocols,
		href: ["http", "https", "mailto"],
		src: ["http", "https"],
		cite: ["http", "https"],
		longDesc: ["http", "https"],
	},
};

/**
 * Hardened rehype plugins for Streamdown.
 *
 * Overrides Streamdown's default `rehype-harden` config which uses wildcards
 * (`["*"]`) for allowedProtocols, allowedLinkPrefixes, and allowedImagePrefixes.
 * Instead, restricts to http/https only and disables data: image URLs.
 */
export const hardenedRehypePlugins: PluggableList = [
	rehypeRaw,
	[rehypeSanitize, sanitizeSchema],
	[
		harden,
		{
			allowedProtocols: ALLOWED_PROTOCOLS,
			allowedLinkPrefixes: ["http://", "https://", "mailto:"],
			allowedImagePrefixes: ["http://", "https://"],
			allowDataImages: false,
			defaultOrigin: undefined,
		},
	],
];
