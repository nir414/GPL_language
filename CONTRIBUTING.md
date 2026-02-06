# Contributing to GPL Language Support

Thank you for your interest in contributing to GPL Language Support! This document provides guidelines for contributing to the project.

## 🌟 How to Contribute

### Reporting Bugs

If you find a bug, please create an issue with the following information:

- **Description**: Clear description of the problem
- **Steps to Reproduce**: Detailed steps to reproduce the issue
- **Expected Behavior**: What you expected to happen
- **Actual Behavior**: What actually happened
- **Environment**:
  - VS Code version
  - Extension version
  - Operating system
- **GPL Code Sample**: Minimal GPL code that demonstrates the issue (if applicable)

### Suggesting Features

We welcome feature suggestions! Please create an issue with:

- **Use Case**: Why this feature would be useful
- **Proposed Solution**: How you envision it working
- **Alternatives**: Other approaches you've considered

### Pull Requests

1. **Fork** the repository
2. **Create a branch** from `main`: `git checkout -b feature/your-feature-name`
3. **Make your changes** following the coding guidelines below
4. **Test** your changes thoroughly
5. **Commit** with clear, descriptive messages
6. **Push** to your fork
7. **Submit a Pull Request** to the `main` branch

## 🛠️ Development Setup

### Prerequisites

- **Node.js** (v16 or higher)
- **npm**
- **VS Code** (v1.74.0 or higher)

### Getting Started

1. Clone the repository:

   ```bash
   git clone https://github.com/nir414/GPL_language.git
   cd GPL_language
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the extension:

   ```bash
   npm run compile
   ```

4. Open in VS Code and press **F5** to launch Extension Development Host

### Project Structure

```
src/
├── extension.ts              # Extension entry point
├── gplParser.ts              # GPL language parser
├── symbolCache.ts            # Symbol caching and indexing
├── config.ts                 # Configuration management
└── providers/                # Language feature providers
    ├── definitionProvider.ts
    ├── referenceProvider.ts
    ├── completionProvider.ts
    ├── diagnosticProvider.ts
    └── ...
```

## 📝 Coding Guidelines

### TypeScript Style

- Use **TypeScript** for all source code
- Enable strict type checking
- Prefer `const` over `let`
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### File Naming

- Use camelCase for file names: `symbolCache.ts`
- Provider files end with `Provider.ts`: `definitionProvider.ts`

### Code Patterns

#### 1. GPL File Detection

Always use `isGplDocument()` to check if a document is GPL:

```typescript
function isGplDocument(document: vscode.TextDocument): boolean {
  const fsPath = document.uri.fsPath.toLowerCase();
  return (
    document.uri.scheme === "file" &&
    (fsPath.endsWith(".gpl") || fsPath.endsWith(".gpo"))
  );
}
```

**Never** rely solely on `document.languageId` as VS Code may open `.gpl` files with `languageId: 'vb'`.

#### 2. Logging

Use trace logging with workspace settings check:

```typescript
private log(message: string) {
    if (!isTraceVerbose(vscode.workspace)) return;
    this.outputChannel?.appendLine(message);
}
```

User can control logging with `gpl.trace.server` setting (`off`, `messages`, `verbose`).

#### 3. Symbol Cache

When working with symbols:

- Use `SymbolCache.getInstance()` for the singleton instance
- Respect `blockDepth` for local variable scoping
- Handle both qualified (`Module.Member`) and unqualified (`Member`) references

### Testing

Currently, the project uses manual testing. Automated tests are welcome! If adding tests:

- Place test files in `src/test/`
- Use the VS Code Extension Test Runner
- Name test files with `.test.ts` suffix

### Documentation

- Update README.md if adding user-facing features
- Update CHANGELOG.md following [Keep a Changelog](https://keepachangelog.com/) format
- Add inline comments for complex logic
- Update this CONTRIBUTING.md if changing development processes

## 🔍 Code Review Process

All submissions require review. We use GitHub pull requests for this purpose:

1. Maintainers will review your PR
2. Address any feedback or requested changes
3. Once approved, a maintainer will merge your PR

## 📋 Commit Message Guidelines

Use clear, descriptive commit messages:

```
feat: add support for nested classes
fix: resolve reference search in module members
docs: update installation instructions
refactor: simplify symbol cache indexing
test: add unit tests for parser
```

Prefixes:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

## 🏗️ Project-Specific Guidelines

### GPL Language Knowledge

Familiarity with GPL (Guidance Programming Language) is helpful but not required. Key points:

- GPL is similar to VB.NET in syntax
- Used for Brooks Automation robot control
- Key constructs: `Module`, `Class`, `Function`, `Sub`, `Dim`
- Main file extensions: `.gpl`, `.gpo`

### Parser Changes

When modifying `gplParser.ts`:

- Handle both `Public Shared` and `Shared Public` keyword orders
- Respect `blockDepth` for local vs. module-level symbols
- Test with real GPL code samples from Brooks Automation controllers

### Symbol Cache Optimization

When modifying `symbolCache.ts`:

- Consider `Project.gpr` optimization (only index ProjectSource files)
- Maintain backward compatibility for workspaces without `.gpr`
- Test with large workspaces (1000+ files)

## 🚀 Release Process

For maintainers: Creating a new release is automated through GitHub Actions. See the [Release Process Guide](docs/RELEASE_PROCESS.md) for detailed instructions.

**Quick release steps:**

```powershell
# 1. Bump version
npm run bump:patch  # or bump:minor, bump:major

# 2. Edit CHANGELOG.md, commit and push
git add package.json CHANGELOG.md
git commit -m "chore: bump version to X.Y.Z"
git push origin main

# 3. Create and push tag (triggers automatic release)
git tag vX.Y.Z
git push origin vX.Y.Z
```

The GitHub Actions workflow will automatically:

- Build and package the VSIX
- Create a GitHub Release with changelog notes
- Attach the VSIX file

See [Quick Release Guide](docs/QUICK_RELEASE.md) for a condensed version.

## ❓ Questions?

If you have questions:

- Check existing [Issues](https://github.com/nir414/GPL_language/issues)
- Open a new issue with the `question` label
- Review the [README](README.md) for basic usage

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to GPL Language Support! 🎉
