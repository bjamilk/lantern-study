# Step 1: GitHub remote

This repo is ready to push once you connect a real GitHub remote.

## Prerequisites

- [GitHub account](https://github.com/signup)
- [GitHub CLI](https://cli.github.com/) (`gh`) — installed on this machine

## One-time login

In a terminal at the project root:

```powershell
gh auth login
```

Choose:

1. **GitHub.com**
2. **HTTPS**
3. **Login with a web browser** (easiest)
4. Follow the browser prompt and paste the code if asked

Verify:

```powershell
gh auth status
```

## Create the remote repo and push

This project’s remote:

**https://github.com/bjamilk/lantern-study** (private)

If setting up on a new machine:

```powershell
git remote add origin https://github.com/bjamilk/lantern-study.git
git push -u origin main
```

To create a fresh repo under your account:

```powershell
gh repo create lantern-study --private --source=. --remote=origin --push
```

If push fails with **workflow scope** error, run `gh auth refresh -h github.com -s workflow` and approve in the browser, then push again.

## What gets pushed (and what does not)

**Included:** application code, Supabase migrations, CI workflows, `.env.example` templates.

**Excluded** (via `.gitignore`):

- `.env` and other secret env files
- `node_modules/`, build output, `.turbo/`
- `.migration-payloads/` (local migration tooling)
- Expo export folders

**Never commit:** Supabase **service role** key, OpenAI/Groq keys, Apple secret JWT, production passwords.

## After push

1. Open the repo on GitHub → **Actions** tab → confirm the **CI** workflow passes on `main`.
2. Next step: [02-supabase-cloud.md](./02-supabase-cloud.md) — link CLI, push migrations, configure auth.

## Rollback / fix broken deploys

```powershell
git pull
# edit files locally
git add .
git commit -m "Fix: describe what you fixed"
git push
```

GitHub keeps history; you can revert a bad commit from the GitHub website (**Commits** → **Revert**) or with `git revert`.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `origin` URL is `[URL]` or invalid | `git remote remove origin` then add again |
| `Permission denied` | Run `gh auth login` again |
| CI fails on push | Open Actions log; fix errors locally and push again |
| Pushed a secret by accident | Rotate the key immediately in Supabase/Dashboard; remove from git history or make repo private |
