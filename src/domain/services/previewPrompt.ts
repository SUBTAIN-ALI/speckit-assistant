import { PREVIEW_CONFIG_FILE } from '../models/preview';

// Instructions for the coding agent. The agent works out HOW to run the project;
// the app runs it (an agent's own background server would stop with the agent).

const CONFIG_SHAPE = `Write ${PREVIEW_CONFIG_FILE} as JSON, exactly this shape:
{
  "command": "<foreground command that starts the dev server, e.g. pnpm dev>",
  "cwd": "<folder to run it in, relative to the project root; \\"\\" for the root>",
  "port": <the port it listens on>,
  "path": "<page to open first, e.g. />",
  "notes": "<one or two sentences: what you set up, anything the user must still do>"
}
Rules for "command":
- It must run in the foreground and keep running (no "&", no "nohup", no daemon/detached mode).
- Use the project's own package manager and scripts (e.g. "pnpm dev", "npm run dev", "python manage.py runserver 127.0.0.1:{port}").
- The app sets the PORT environment variable to a free port; write "{port}" where the command needs the port, or rely on $PORT when the framework reads it.
- Listen on localhost only.`;

export function preparePreviewPrompt(feature?: string | null): string {
  return `Prepare a local preview of this project for the user. Work out how to run it in development mode on this computer — do not change what the application does.

1. Inspect the project: package.json scripts and lock files, framework config, README, docker-compose, manage.py, Gemfile, pubspec.yaml, etc. A monorepo: pick the app the user would want to see (the web frontend).
2. Install dependencies if they are missing, with the project's package manager.
3. If the app needs an env file to start, create it from the example file (e.g. .env.example → .env.local) only if it doesn't exist, with harmless local development values. Never invent real credentials; mention anything the user must fill in.
4. You may start the server briefly to check that it answers, but stop it before you finish. Leave nothing running: this app will start it.
5. ${CONFIG_SHAPE}
${feature ? `\nThe user wants to see the feature in specs/${feature}/ — set "path" to the page where it shows, if you can tell from the code.\n` : ''}
Finish with one line: PREVIEW: <the command>.`;
}

export function fixPreviewPrompt(command: string, logs: string, error?: string): string {
  return `The local preview of this project failed to start.

Command: ${command}
${error ? `Problem: ${error}\n` : ''}Last output:
\`\`\`
${logs.slice(-6000)}
\`\`\`

Find the cause and fix it so the dev server starts (install missing dependencies, a missing env file from its example, a wrong command or folder…). Don't change what the application does. You may start the server briefly to check it, but stop it before you finish.
Then update ${PREVIEW_CONFIG_FILE}. ${CONFIG_SHAPE}

Finish with one line: PREVIEW: <the command>.`;
}
