import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectInfo {
  name: string;
  path: string;
  description: string;
  language: string;
  framework: string;
  packageManager: string;
  gitBranch: string;
  gitStatus: { staged: number; unstaged: number; untracked: number };
  dependencies: number;
  devDependencies: number;
  scripts: Record<string, string>;
  fileCount: number;
  totalLines: number;
  lastCommit: { hash: string; message: string; author: string; date: number };
  readme: string | null;
  depList: Array<{ name: string; version: string; dev: boolean }>;
}

export interface ProjectSuggestion {
  id: string;
  type: "fix" | "improve" | "security" | "performance" | "docs";
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  command?: string;
}

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gitExec(args: string[], cwd: string): Promise<string> {
  return invoke<string>("git_command", { args, cwd });
}

function detectFramework(deps: Record<string, string>): string {
  if (deps["next"]) return "Next.js";
  if (deps["nuxt"] || deps["nuxt3"]) return "Nuxt";
  if (deps["@angular/core"]) return "Angular";
  if (deps["svelte"] || deps["@sveltejs/kit"]) return "Svelte";
  if (deps["vue"]) return "Vue";
  if (deps["react"]) return "React";
  if (deps["vite"]) return "Vite";
  if (deps["express"]) return "Express";
  if (deps["fastify"]) return "Fastify";
  if (deps["electron"]) return "Electron";
  if (deps["@tauri-apps/api"]) return "Tauri";
  return "Unknown";
}

function detectLanguage(files: FileEntry[]): string {
  const ext: Record<string, number> = {};
  for (const f of files) {
    if (f.is_dir) continue;
    const dot = f.name.lastIndexOf(".");
    if (dot > 0) {
      const e = f.name.slice(dot + 1).toLowerCase();
      ext[e] = (ext[e] || 0) + 1;
    }
  }
  const sorted = Object.entries(ext).sort((a, b) => b[1] - a[1]);
  const top = sorted[0]?.[0] || "";
  const map: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
    rs: "Rust", py: "Python", go: "Go", java: "Java", rb: "Ruby",
    cpp: "C++", c: "C", cs: "C#", swift: "Swift", kt: "Kotlin",
  };
  return map[top] || top || "Unknown";
}

function detectPackageManager(files: FileEntry[]): string {
  const names = new Set(files.map((f) => f.name));
  if (names.has("pnpm-lock.yaml")) return "pnpm";
  if (names.has("yarn.lock")) return "yarn";
  if (names.has("bun.lockb")) return "bun";
  if (names.has("package-lock.json")) return "npm";
  if (names.has("Cargo.lock")) return "cargo";
  if (names.has("go.sum")) return "go";
  if (names.has("Pipfile.lock") || names.has("poetry.lock")) return "pip";
  return "unknown";
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.split("\n").length;
}

// ---------------------------------------------------------------------------
// Suggestion generator
// ---------------------------------------------------------------------------

function generateSuggestions(
  project: ProjectInfo,
  rootFiles: FileEntry[],
): ProjectSuggestion[] {
  const suggestions: ProjectSuggestion[] = [];
  const fileNames = new Set(rootFiles.map((f) => f.name));

  // Missing tests
  const hasTests = rootFiles.some(
    (f) => f.is_dir && (f.name === "test" || f.name === "tests" || f.name === "__tests__"),
  ) || fileNames.has("jest.config.js") || fileNames.has("vitest.config.ts");
  if (!hasTests) {
    suggestions.push({
      id: "missing-tests",
      type: "improve",
      title: "Add unit tests",
      description: "No test directory or test config found. Consider adding tests to improve reliability.",
      priority: "high",
      command: "Help me set up a testing framework and write initial tests for this project.",
    });
  }

  // No CI config
  const hasCI = fileNames.has(".github") || fileNames.has(".gitlab-ci.yml") || fileNames.has("Jenkinsfile");
  if (!hasCI) {
    suggestions.push({
      id: "missing-ci",
      type: "improve",
      title: "Set up CI/CD pipeline",
      description: "No CI configuration found. Add GitHub Actions or similar for automated builds and tests.",
      priority: "medium",
      command: "Create a GitHub Actions CI workflow for this project that runs linting, tests, and builds.",
    });
  }

  // No README
  if (!project.readme) {
    suggestions.push({
      id: "missing-readme",
      type: "docs",
      title: "Generate README",
      description: "No README.md found. A good README helps contributors understand the project quickly.",
      priority: "medium",
      command: "Generate a comprehensive README.md for this project based on its structure and dependencies.",
    });
  }

  // Security audit
  if (project.dependencies > 20) {
    suggestions.push({
      id: "dep-audit",
      type: "security",
      title: "Run dependency audit",
      description: `${project.dependencies} dependencies detected. Run an audit to check for known vulnerabilities.`,
      priority: "high",
      command: "Run a security audit on this project's dependencies and summarize any vulnerabilities found.",
    });
  }

  // Large file count
  if (project.fileCount > 500) {
    suggestions.push({
      id: "large-codebase",
      type: "performance",
      title: "Review project structure",
      description: `${project.fileCount} files detected. Consider modularizing or cleaning up unused files.`,
      priority: "low",
      command: "Analyze this project structure and suggest ways to better organize or reduce file count.",
    });
  }

  // No .gitignore
  if (!fileNames.has(".gitignore")) {
    suggestions.push({
      id: "missing-gitignore",
      type: "fix",
      title: "Add .gitignore",
      description: "No .gitignore found. Add one to avoid committing build artifacts and sensitive files.",
      priority: "high",
      command: "Generate a comprehensive .gitignore file for this project based on its language and framework.",
    });
  }

  // No linting config
  const hasLint = fileNames.has(".eslintrc.js") || fileNames.has(".eslintrc.json") ||
    fileNames.has("eslint.config.js") || fileNames.has("eslint.config.mjs") ||
    fileNames.has("biome.json") || fileNames.has(".prettierrc");
  if (!hasLint && (project.language === "TypeScript" || project.language === "JavaScript")) {
    suggestions.push({
      id: "missing-lint",
      type: "improve",
      title: "Add linting configuration",
      description: "No ESLint or Prettier config found. Linting enforces consistent code style.",
      priority: "medium",
      command: "Set up ESLint and Prettier for this project with sensible defaults.",
    });
  }

  // Untracked files in git
  if (project.gitStatus.untracked > 5) {
    suggestions.push({
      id: "untracked-files",
      type: "fix",
      title: "Review untracked files",
      description: `${project.gitStatus.untracked} untracked files. Stage, ignore, or clean up stale files.`,
      priority: "low",
      command: "List all untracked files in this repo and help me decide which to stage, ignore, or delete.",
    });
  }

  return suggestions.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProjectDashboard(projectPath?: string) {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [suggestions, setSuggestions] = useState<ProjectSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cwdRef = useRef(projectPath || ".");

  useEffect(() => {
    if (projectPath) cwdRef.current = projectPath;
  }, [projectPath]);

  const cwd = () => cwdRef.current;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. List root files
      const rootFiles = await invoke<FileEntry[]>("file_list", { path: cwd() });

      // 2. Parallel reads: package.json, git info, readme
      const fileNames = new Set(rootFiles.map((f) => f.name));
      const hasPackageJson = fileNames.has("package.json");
      const hasCargoToml = fileNames.has("Cargo.toml");
      const readmeName = ["README.md", "readme.md", "Readme.md"].find((n) => fileNames.has(n));

      const [pkgRaw, cargoRaw, readmeRaw, branchRaw, porcelainRaw, logRaw] = await Promise.all([
        hasPackageJson
          ? invoke<string>("file_read", { path: `${cwd()}/package.json` }).catch(() => "")
          : Promise.resolve(""),
        hasCargoToml
          ? invoke<string>("file_read", { path: `${cwd()}/Cargo.toml` }).catch(() => "")
          : Promise.resolve(""),
        readmeName
          ? invoke<string>("file_read", { path: `${cwd()}/${readmeName}` }).catch(() => null)
          : Promise.resolve(null),
        gitExec(["status", "--branch", "--porcelain"], cwd()).catch(() => ""),
        gitExec(["status", "--porcelain"], cwd()).catch(() => ""),
        gitExec(["log", "--format=%H%x00%s%x00%an%x00%ct", "-1"], cwd()).catch(() => ""),
      ]);

      // Parse package.json
      let pkgName = "";
      let pkgDesc = "";
      let allDeps: Record<string, string> = {};
      let allDevDeps: Record<string, string> = {};
      let scripts: Record<string, string> = {};
      if (pkgRaw) {
        try {
          const pkg = JSON.parse(pkgRaw);
          pkgName = pkg.name || "";
          pkgDesc = pkg.description || "";
          allDeps = pkg.dependencies || {};
          allDevDeps = pkg.devDependencies || {};
          scripts = pkg.scripts || {};
        } catch { /* invalid json */ }
      }

      // Parse Cargo.toml (basic)
      if (cargoRaw && !pkgName) {
        const nameMatch = cargoRaw.match(/^name\s*=\s*"(.+?)"/m);
        const descMatch = cargoRaw.match(/^description\s*=\s*"(.+?)"/m);
        if (nameMatch) pkgName = nameMatch[1];
        if (descMatch) pkgDesc = descMatch[1];
      }

      // Derive project name from folder if needed
      if (!pkgName) {
        const parts = cwd().replace(/\\/g, "/").split("/");
        pkgName = parts[parts.length - 1] || "project";
      }

      // Git branch
      let branch = "none";
      const branchMatch = branchRaw.match(/^## (\S+?)(?:\.\.\.|$)/m);
      if (branchMatch) branch = branchMatch[1];

      // Git status counts
      let staged = 0;
      let unstaged = 0;
      let untracked = 0;
      for (const line of porcelainRaw.split("\n").filter(Boolean)) {
        const idx = line[0];
        const work = line[1];
        if (idx === "?" && work === "?") { untracked++; continue; }
        if (idx && idx !== " " && idx !== "?") staged++;
        if (work && work !== " " && work !== "?") unstaged++;
      }

      // Last commit
      let lastCommit = { hash: "", message: "No commits", author: "", date: 0 };
      if (logRaw.trim()) {
        const parts = logRaw.trim().split("\x00");
        if (parts.length >= 4) {
          lastCommit = {
            hash: parts[0].slice(0, 7),
            message: parts[1],
            author: parts[2],
            date: parseInt(parts[3], 10) * 1000,
          };
        }
      }

      // Count files and approximate lines
      const codeFiles = rootFiles.filter((f) => !f.is_dir);
      const fileCount = rootFiles.length;
      let totalLines = 0;
      for (const f of codeFiles.slice(0, 30)) {
        try {
          const content = await invoke<string>("file_read", { path: f.path });
          totalLines += countLines(content);
        } catch { /* skip unreadable */ }
      }
      // Extrapolate if there are many more files
      if (codeFiles.length > 30) {
        totalLines = Math.round(totalLines * (codeFiles.length / 30));
      }

      // Build dep list
      const depList = [
        ...Object.entries(allDeps).map(([name, version]) => ({ name, version, dev: false })),
        ...Object.entries(allDevDeps).map(([name, version]) => ({ name, version, dev: true })),
      ];

      const framework = detectFramework({ ...allDeps, ...allDevDeps });
      const language = detectLanguage(rootFiles);
      const packageManager = detectPackageManager(rootFiles);

      const info: ProjectInfo = {
        name: pkgName,
        path: cwd(),
        description: pkgDesc,
        language,
        framework,
        packageManager,
        gitBranch: branch,
        gitStatus: { staged, unstaged, untracked },
        dependencies: Object.keys(allDeps).length,
        devDependencies: Object.keys(allDevDeps).length,
        scripts,
        fileCount,
        totalLines,
        lastCommit,
        readme: readmeRaw,
        depList,
      };

      setProject(info);
      setSuggestions(generateSuggestions(info, rootFiles));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const runScript = useCallback(async (name: string) => {
    if (!project) return;
    const pm = project.packageManager;
    const cmd = pm === "yarn" ? `yarn ${name}` : pm === "pnpm" ? `pnpm run ${name}` : `npm run ${name}`;
    try {
      await invoke("run_shell", { command: cmd, cwd: cwd() });
    } catch (e) {
      setError(`Script error: ${e}`);
    }
  }, [project]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { project, suggestions, loading, error, refresh, runScript };
}
