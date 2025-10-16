const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("fs-extra");

const rootDir = path.resolve(__dirname, "..");
const tsconfigPath = path.join(rootDir, "tsconfig.json");
const buildDir = path.join(rootDir, "build");
const distDir = path.join(rootDir, "dist");

const layerStagingDir = path.join(buildDir, "lambda-layer");
const layerNodejsDir = path.join(layerStagingDir, "nodejs");
const functionStagingDir = path.join(buildDir, "lambda-function");

const functionZipPath = path.join(distDir, "lambda_handler.zip");
const layerZipPath = path.join(distDir, "lambda_layer.zip");

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

  if (packageManager === "pnpm") {
    runCommand("pnpm", ["exec", "tsc", "--project", tsconfigPath], { cwd: rootDir });
    runCommand("pnpm", ["exec", "tsc-alias", "--project", tsconfigPath], { cwd: rootDir });
    return;
  }

  runCommand("npx", ["tsc", "--project", tsconfigPath], { cwd: rootDir });
  runCommand("npx", ["tsc-alias", "--project", tsconfigPath], { cwd: rootDir });
}

async function copyPackageMetadata(destinationDir) {
  const pkgJsonSrc = path.join(rootDir, "package.json");
  const pkgJsonDst = path.join(destinationDir, "package.json");
  await fs.copyFile(pkgJsonSrc, pkgJsonDst).catch(() => {});

  const pnpmLockSrc = path.join(rootDir, "pnpm-lock.yaml");
  const npmLockSrc = path.join(rootDir, "package-lock.json");

  if (await fs.pathExists(pnpmLockSrc)) {
    await fs.copyFile(pnpmLockSrc, path.join(destinationDir, "pnpm-lock.yaml"));
  } else if (await fs.pathExists(npmLockSrc)) {
    await fs.copyFile(npmLockSrc, path.join(destinationDir, "package-lock.json"));
  }
}

async function installProdDependencies(destinationDir, packageManager) {
  console.log("[build-lambda] Installing production dependencies");

  if (packageManager === "pnpm") {
    runCommand("pnpm", ["install", "--prod", "--frozen-lockfile", "--ignore-scripts"], { cwd: destinationDir });
    return;
  }

  runCommand("npm", ["ci", "--omit=dev", "--ignore-scripts"], { cwd: destinationDir });
}

async function copyFunctionSources() {
  const compiledSrcDir = path.join(distDir, "src");
  if (!(await fs.pathExists(compiledSrcDir))) {
    throw new Error("Compiled sources not found. Did the TypeScript compilation step complete successfully?");
  }

  await fs.copy(compiledSrcDir, functionStagingDir);
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

  await fs.writeFile(path.join(layerNodejsDir, ".npmrc"), "node-linker=hoisted\n");

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

  console.log("[build-lambda] Creating Lambda function archive");
  await createZipArchive(functionStagingDir, functionZipPath);

  const stats = await fs.stat(functionZipPath);
  console.log(`[build-lambda] Function artifact: ${functionZipPath} (${stats.size} bytes)`);
}

async function main() {
  await fs.ensureDir(buildDir);
  await fs.ensureDir(distDir);
  await fs.emptyDir(distDir);

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
