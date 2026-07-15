import obsidianmd from "eslint-plugin-obsidianmd";

export default [
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				project: "./tsconfig.json",
			},
		},
	},
	{
		ignores: ["main.js", "node_modules/**", "scripts/**", "esbuild.config.mjs"],
	},
];
