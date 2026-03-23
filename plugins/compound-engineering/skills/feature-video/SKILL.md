---
name: feature-video
description: Record a video walkthrough of a feature and add it to the PR description. Use when a PR needs a visual demo for reviewers, when the user asks to demo a feature, create a PR video, record a walkthrough, show what changed visually, or add a video to a pull request.
argument-hint: "[PR number or 'current'] [optional: base URL, default localhost:3000]"
---

# Feature Video Walkthrough

Record browser interactions demonstrating a feature, stitch screenshots into an MP4 video, upload natively to GitHub, and embed in the PR description as an inline video player.

## Prerequisites

- Local development server running (e.g., `bin/dev`, `npm run dev`, `rails server`)
- `agent-browser` CLI installed (load the `agent-browser` skill for details)
- `ffmpeg` installed (for video conversion)
- `gh` CLI authenticated with push access to the repo
- Git repository with a PR to document
- One-time GitHub browser auth (see Step 6 auth check)

## Main Tasks

### 1. Parse Arguments

**Arguments:** $ARGUMENTS

Parse the input:
- First argument: PR number or "current" (defaults to current branch's PR)
- Second argument: Base URL (defaults to `http://localhost:3000`)

```bash
gh pr view --json number -q '.number'
```

### 2. Gather Feature Context

Get PR details and changed files to determine what to demonstrate:

```bash
gh pr view [number] --json title,body,files,headRefName -q '.'
```

```bash
gh pr view [number] --json files -q '.files[].path'
```

Map changed files to routes/pages that should be demonstrated. Examine the project's routing configuration (e.g., `routes.rb`, `next.config.js`, `app/` directory structure) to determine which URLs correspond to the changed files.

### 3. Plan the Video Flow

Before recording, create a shot list:

1. **Opening shot**: Homepage or starting point (2-3 seconds)
2. **Navigation**: How user gets to the feature
3. **Feature demonstration**: Core functionality (main focus)
4. **Edge cases**: Error states, validation, etc. (if applicable)
5. **Success state**: Completed action/result

Present the proposed flow to the user for confirmation before recording.

**Use the platform's blocking question tool when available** (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini). Otherwise, present numbered options and wait for the user's reply before proceeding:

```
Proposed Video Flow for PR #[number]: [title]

1. Start at: /[starting-route]
2. Navigate to: /[feature-route]
3. Demonstrate:
   - [Action 1]
   - [Action 2]
   - [Action 3]
4. Show result: [success state]

Estimated duration: ~[X] seconds

1. Start recording
2. Modify the flow (describe changes)
3. Add specific interactions to demonstrate
```

### 4. Record the Walkthrough

Create output directories:

```bash
mkdir -p .context/compound-engineering/feature-video/screenshots
mkdir -p .context/compound-engineering/feature-video/videos
```

Execute the planned flow, capturing each step with agent-browser. Number screenshots sequentially for correct frame ordering:

```bash
agent-browser open "[base-url]/[start-route]"
agent-browser wait 2000
agent-browser screenshot .context/compound-engineering/feature-video/screenshots/01-start.png
```

```bash
agent-browser snapshot -i
agent-browser click @e1
agent-browser wait 1000
agent-browser screenshot .context/compound-engineering/feature-video/screenshots/02-navigate.png
```

```bash
agent-browser snapshot -i
agent-browser click @e2
agent-browser wait 1000
agent-browser screenshot .context/compound-engineering/feature-video/screenshots/03-feature.png
```

```bash
agent-browser wait 2000
agent-browser screenshot .context/compound-engineering/feature-video/screenshots/04-result.png
```

### 5. Create Video

Stitch screenshots into an MP4:

```bash
ffmpeg -y -framerate 0.5 -pattern_type glob -i '.context/compound-engineering/feature-video/screenshots/*.png' \
  -c:v libx264 -pix_fmt yuv420p -vf "scale=1280:-2" \
  .context/compound-engineering/feature-video/videos/feature-demo.mp4
```

Notes:
- `-framerate 0.5` = 2 seconds per frame. Adjust for faster/slower playback.
- `-2` in scale ensures height is divisible by 2 (required for H.264).

### 6. Authenticate & Upload to GitHub

Upload produces a `user-attachments/assets/` URL that GitHub renders as a native inline video player -- the same result as pasting a video into the PR editor manually.

The approach: close any existing agent-browser session, start a Chrome-engine session with saved GitHub auth, navigate to the PR page, set the video file on the comment form's hidden file input, wait for GitHub to process the upload, extract the resulting URL, then clear the textarea without submitting.

#### Check for existing session

First, check if a saved GitHub session already exists:

```bash
agent-browser close
agent-browser --engine chrome --session-name github open https://github.com/settings/profile
agent-browser get title
```

If the page title contains the user's GitHub username or "Profile", the session is still valid -- skip to "Upload the video" below. If it redirects to the login page, the session has expired or was never created -- proceed to "Auth setup".

#### Auth setup (one-time)

Establish an authenticated GitHub session. This only needs to happen once -- session cookies persist across runs via the `--session-name` flag.

Close the current session and open the GitHub login page in a headed Chrome window:

```bash
agent-browser close
agent-browser --engine chrome --headed --session-name github open https://github.com/login
```

The user must log in manually in the browser window (handles 2FA, SSO, OAuth -- any login method). **Use the platform's blocking question tool** (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini) to prompt:

```
GitHub login required for video upload.

A Chrome window has opened to github.com/login. Please log in manually
(this handles 2FA/SSO/OAuth automatically). Reply when done.
```

After login, verify the session works:

```bash
agent-browser open https://github.com/settings/profile
```

If the profile page loads, auth is confirmed. The `github` session is now saved and reusable.

#### Upload the video

Navigate to the PR comment form and upload via the hidden file input:

```bash
agent-browser open "https://github.com/[owner]/[repo]/pull/[number]"
agent-browser scroll down 5000
agent-browser upload '#fc-new_comment_field' .context/compound-engineering/feature-video/videos/feature-demo.mp4
```

Wait for GitHub to process the upload (typically 3-5 seconds), then read the textarea value:

```bash
agent-browser wait 5000
agent-browser eval "document.getElementById('new_comment_field').value"
```

The textarea will contain a URL like `https://github.com/user-attachments/assets/[uuid]`. Extract this URL -- it is the VIDEO_URL for embedding.

Clear the textarea without submitting (the upload is already persisted server-side):

```bash
agent-browser eval "const ta = document.getElementById('new_comment_field'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }))"
```

### 7. Update PR Description

Get the current PR body:

```bash
gh pr view [number] --json body -q '.body'
```

Append a Demo section (or replace an existing one). The video URL renders as an inline player when placed on its own line:

```markdown
## Demo

https://github.com/user-attachments/assets/[uuid]

*Automated video walkthrough*
```

Update the PR:

```bash
gh pr edit [number] --body "[updated body with demo section]"
```

### 8. Cleanup

Ask the user before removing temporary files. If confirmed, clean up scratch space:

```bash
rm -r .context/compound-engineering/feature-video
```

Present a completion summary:

```
Feature Video Complete

PR: #[number] - [title]
Video: [VIDEO_URL]

Shots captured:
1. [description]
2. [description]
3. [description]
4. [description]

PR description updated with demo section.
```

## Usage Examples

```bash
# Record video for current branch's PR
/feature-video

# Record video for specific PR
/feature-video 847

# Record with custom base URL
/feature-video 847 http://localhost:5000

# Record for staging environment
/feature-video current https://staging.example.com
```

## Tips

- Keep it short: 10-30 seconds is ideal for PR demos
- Focus on the change: don't include unrelated UI
- Show before/after: if fixing a bug, show the broken state first (if possible)
- The `--session-name github` session expires when GitHub invalidates the cookies (typically weeks). If upload fails with a login redirect, re-run the auth setup.
- GitHub DOM selectors (`#fc-new_comment_field`, `#new_comment_field`) may change if GitHub updates its UI. If the upload silently fails, inspect the PR page for updated selectors.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ffmpeg: command not found` | ffmpeg not installed | Install via `brew install ffmpeg` (macOS) or equivalent |
| `agent-browser: command not found` | agent-browser not installed | Load the `agent-browser` skill for installation instructions |
| Textarea empty after upload wait | Session expired, or GitHub processing slow | Check session validity (Step 6 auth check). If valid, increase wait time and retry. |
| Textarea empty, URL is `github.com/login` | Session expired | Re-run auth setup (Step 6) |
| `gh pr view` fails | No PR for current branch | Create a PR first with `gh pr create` or specify a PR number explicitly |
| Video file too large for upload | Exceeds GitHub's 10MB (free) or 100MB (paid) limit | Re-encode: lower framerate (`-framerate 0.33`), reduce resolution (`scale=960:-2`), or increase CRF (`-crf 28`) |
| Upload URL does not contain `user-attachments/assets/` | Wrong upload method or GitHub change | Verify the file input selector is still correct by inspecting the PR page |
