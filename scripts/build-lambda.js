const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("fs-extra");

const rootDir = path.resolve(__dirname, "..");
const tsconfigPath = path.join(rootDir, "tsconfig.json");
const buildDir = path.join(rootDir, "build");
const distDir = path.join(rootDir, "dist");
const functionZipPath = path.join(distDir, "lambda_handler.zip");
const layerZipPath = path.join(distDir, "lambda_layer.zip");

const layerStagingDir = path.join(buildDir, "lambda-layer");
const layerNodejsDir = path.join(layerStagingDir, "nodejs");
const functionStagingDir = path.join(buildDir, "lambda-function");

function runCommand(command, args, options) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")} (exit code ${result.status ?? "unknown"})`);
  }
}

async function detectPackageManager() {
  const pnpmLock = path.join(rootDir, "pnpm-lock.yaml");
  const npmLock = path.join(rootDir, "package-lock.json");

  const hasPnpmLock = await fs.pathExists(pnpmLock);
  const hasNpmLock = await fs.pathExists(npmLock);

  if (hasPnpmLock) return "pnpm";
  if (hasNpmLock) return "npm";

  throw new Error("No lockfile found (pnpm-lock.yaml or package-lock.json). Please commit a lockfile.");
}

async function cleanDirectory(directoryPath) {
  await fs.remove(directoryPath);
  await fs.ensureDir(directoryPath);
}

async function compileTypescript(packageManager) {
  console.log("[build-lambda] Compiling TypeScript sources");
  const aliasTargets = [distDir];

  if (packageManager === "pnpm") {
    runCommand("pnpm", ["exec", "tsc", "--project", tsconfigPath], { cwd: rootDir });
    for (const target of aliasTargets) {
      runCommand(
        "pnpm",
        ["exec", "tsc-alias", "--project", tsconfigPath, "--outDir", target],
        { cwd: rootDir },
      );
    }
    return;
  }

  runCommand("npx", ["tsc", "--project", tsconfigPath], { cwd: rootDir });
  for (const target of aliasTargets) {
    runCommand("npx", ["tsc-alias", "--project", tsconfigPath, "--outDir", target], { cwd: rootDir });
  }
}

async function copyPackageMetadata(destinationDir) {
  const pkgJsonSrc = path.join(rootDir, "package.json");
  const pkgJsonDst = path.join(destinationDir, "package.json");
  await fs.copyFile(pkgJsonSrc, pkgJsonDst).catch(() => {});

  const pnpmLockSrc = path.join(rootDir, "pnpm-lock.yaml");
  const npmLockSrc = path.join(rootDir, "package-lock.json");
  const npmrcSrc = path.join(rootDir, ".npmrc");

  if (await fs.pathExists(pnpmLockSrc)) {
    await fs.copyFile(pnpmLockSrc, path.join(destinationDir, "pnpm-lock.yaml"));
  } else if (await fs.pathExists(npmLockSrc)) {
    await fs.copyFile(npmLockSrc, path.join(destinationDir, "package-lock.json"));
  }

  if (await fs.pathExists(npmrcSrc)) {
    await fs.copyFile(npmrcSrc, path.join(destinationDir, ".npmrc"));
  }
}

async function installProdDependencies(destinationDir, packageManager) {
  console.log("[build-lambda] Installing production dependencies");

  if (packageManager === "pnpm") {
    const tempWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), "pnpm-layer-"));
    await fs.copy(path.join(destinationDir, "package.json"), path.join(tempWorkDir, "package.json"));
    if (await fs.pathExists(path.join(destinationDir, "pnpm-lock.yaml"))) {
      await fs.copy(path.join(destinationDir, "pnpm-lock.yaml"), path.join(tempWorkDir, "pnpm-lock.yaml"));
    }
    if (await fs.pathExists(path.join(destinationDir, ".npmrc"))) {
      await fs.copy(path.join(destinationDir, ".npmrc"), path.join(tempWorkDir, ".npmrc"));
    }

    runCommand("pnpm", ["install", "--prod", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: tempWorkDir,
    });

    await fs.copy(path.join(tempWorkDir, "node_modules"), path.join(destinationDir, "node_modules"));
    if (await fs.pathExists(path.join(tempWorkDir, ".pnpm"))) {
      await fs.copy(path.join(tempWorkDir, ".pnpm"), path.join(destinationDir, ".pnpm"));
    }
    await fs.remove(tempWorkDir);
    return;
  }

  runCommand("npm", ["ci", "--omit=dev", "--ignore-scripts"], { cwd: destinationDir });
}

async function copyFunctionSources() {
  const compiledSrcDir = distDir;
  if (!(await fs.pathExists(compiledSrcDir))) {
    throw new Error("Compiled sources not found. Did the TypeScript compilation step complete successfully?");
  }

  await fs.copy(compiledSrcDir, functionStagingDir);
}

async function copyDependenciesIntoFunctionPackage() {
  const depsSourceDir = path.join(layerNodejsDir, "node_modules");
  if (!(await fs.pathExists(depsSourceDir))) {
    throw new Error("Layer dependencies not found; ensure buildLayer completed before building the function package.");
  }
  const depsTargetDir = path.join(functionStagingDir, "node_modules");
  await fs.copy(depsSourceDir, depsTargetDir);

  const packageJsonSrc = path.join(layerNodejsDir, "package.json");
  if (await fs.pathExists(packageJsonSrc)) {
    await fs.copyFile(packageJsonSrc, path.join(functionStagingDir, "package.json"));
  }
}

async function createZipArchive(sourceDir, outputPath) {
  await fs.ensureDir(path.dirname(outputPath));
  await fs.remove(outputPath);
  runCommand("zip", ["-qr", outputPath, "."], { cwd: sourceDir });
}

async function buildLayer(packageManager) {
  console.log("[build-lambda] Preparing Lambda layer");

  await cleanDirectory(layerStagingDir);
  await fs.ensureDir(layerNodejsDir);

  console.log("[build-lambda] Copying package metadata for layer");
  await copyPackageMetadata(layerNodejsDir);

  const npmrcSrc = path.join(rootDir, ".npmrc");
  let npmrcContent = "node-linker=hoisted\n";
  if (await fs.pathExists(npmrcSrc)) {
    const existingContent = await fs.readFile(npmrcSrc, "utf8");
    npmrcContent = existingContent + "\n" + npmrcContent;
  }
  await fs.writeFile(path.join(layerNodejsDir, ".npmrc"), npmrcContent);

  console.log("[build-lambda] Installing dependencies into layer staging");
  await installProdDependencies(layerNodejsDir, packageManager);

  console.log("[build-lambda] Creating Lambda layer archive");
  await createZipArchive(layerStagingDir, layerZipPath);

  const stats = await fs.stat(layerZipPath);
  console.log(`[build-lambda] Layer artifact: ${layerZipPath} (${stats.size} bytes)`);
}

async function buildFunctionArchive() {
  console.log("[build-lambda] Preparing Lambda function package");
  await cleanDirectory(functionStagingDir);

  console.log("[build-lambda] Copying compiled sources into function staging");
  await copyFunctionSources();

  console.log("[build-lambda] Copying runtime dependencies into function package");
  await copyDependenciesIntoFunctionPackage();

  console.log("[build-lambda] Creating Lambda function archive");
  await createZipArchive(functionStagingDir, functionZipPath);

  const stats = await fs.stat(functionZipPath);
  console.log(`[build-lambda] Function artifact: ${functionZipPath} (${stats.size} bytes)`);
}

async function main() {
  await fs.ensureDir(buildDir);
  await fs.ensureDir(distDir);
  await fs.emptyDir(distDir);
  await fs.remove(path.join(rootDir, "tsconfig.tsbuildinfo"));

  const packageManager = await detectPackageManager();

  await compileTypescript(packageManager);
  await buildLayer(packageManager);
  await buildFunctionArchive();
}

main().catch((error) => {
  console.error("[build-lambda] Build failed");
  if (error instanceof Error) console.error(error.message);
  else console.error(error);
  process.exitCode = 1;
});
