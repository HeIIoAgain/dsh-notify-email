# Publishing

This repository is a DeepSeek Harness **bundle**: `package.json` declares
`dsh.bundle.patch` and `cordis.patch.yml` inserts the plugin row. Nothing needs
to be built; the package ships the source it runs.

Repository: <https://github.com/HeIIoAgain/dsh-notify-email>

## 0. Before you start

The manifest already points at `HeIIoAgain/dsh-notify-email`; the two README
install commands use `github:HeIIoAgain/...`. If you rename the repository,
update `package.json` (`repository`, `homepage`, `bugs`) and both README files.

Check that the local checkout is clean:

```sh
npm run check
npm test
```

## 1. Create an empty repository on GitHub

1. Open <https://github.com/new>.
2. Owner: `HeIIoAgain`. Repository name: `dsh-notify-email`.
3. Visibility: public. **Do not** initialize with README, `.gitignore`, or a
   license — the local tree already contains them.
4. Click **Create repository**.

## 2. Push the tree

### Option A — command line (recommended, keeps history)

```sh
cd dsh-notify-email

git init -b main
git config user.name "HeIIoAgain"          # only if not configured globally
git config user.email "you@example.com"    # use the email tied to GitHub
git add .
git commit -m "feat: initial public release"

# HTTPS (asks for a personal access token as the password)
git remote add origin https://github.com/HeIIoAgain/dsh-notify-email.git

# ...or SSH (requires an SSH key added to GitHub)
# git remote add origin git@github.com:HeIIoAgain/dsh-notify-email.git

git push -u origin main
```

Use a GitHub personal access token (classic, `repo` scope) for HTTPS; account
passwords are not accepted.

### Option B — GitHub web upload

<https://github.com/HeIIoAgain/dsh-notify-email/upload/main> → drag the extracted
`dsh-notify-email/` contents (not the folder itself) → commit.

The web flow cannot upload `.github/workflows/` from the browser in some cases;
if the workflow files are skipped, add them later through the API or a local
push.

## 3. Tag a release

```sh
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

Then open <https://github.com/HeIIoAgain/dsh-notify-email/releases/new>, pick the
tag, title it `v1.0.0`, and paste the `1.0.0` section of
[CHANGELOG](CHANGELOG.md).

## 4. Install from GitHub

```sh
dsh plugin --profile web add github:HeIIoAgain/dsh-notify-email#<commit-sha>
```

Find the commit SHA on the repository page (**Code → commits → copy**). Pin a
SHA or tag rather than `main`: DSH loads the package as a bundle and a moving
target makes installations non-reproducible.

## 5. Publish to npm (optional)

`dsh-notify-email` is unscoped in `package.json` and has no runtime
dependencies, so publishing is one command:

```sh
npm login
npm publish --access public
```

After that, `dsh plugin --profile web add dsh-notify-email` works for everyone.

`.github/workflows/publish.yml` publishes on every `v*` tag when the repository
secret `NPM_TOKEN` is set (Settings → Secrets and variables → Actions → New
repository secret). Generate the token at
<https://www.npmjs.com/settings/~/tokens> with **Automation** type.

## 6. After publishing

- Actions tab: the `CI` workflow runs `npm run check`, `npm test`, and
  `npm pack --dry-run` on every push and pull request.
- If the plugin manager shows a generic icon or missing title, confirm
  `icon.svg` and `locale/{en,zh}.json` are present in the repository root.
- Re-run `npm pack --dry-run` after changing `files` in `package.json`; the
  npm tarball must contain `index.js`, `smtp.js`, `cordis.patch.yml`, `icon.svg`,
  and the locale files.
