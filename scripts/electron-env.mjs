// The environment Electron can start cleanly in, shared by the scripts that launch it.
//
// - A parent Electron app (an editor or agent terminal) exports its own binary and identity to
//   children; electron-vite honours ELECTRON_EXEC_PATH, so without the scrub the app would run
//   on the parent's Electron, or as plain Node (ELECTRON_RUN_AS_NODE).
// - On hybrid-GPU Linux sessions the NVIDIA PRIME offload variables break ANGLE and push the
//   whole app onto CPU rendering. Chromium snapshots the environment before app code runs, so
//   they have to be gone before the binary is exec'd.
// - ROCKET_NO_SANDBOX=1 is the opt-out for kernels that forbid unprivileged user namespaces
//   while the npm-installed chrome-sandbox helper is not SUID root.
export function electronEnv(base = process.env) {
  const env = { ...base }
  for (const name of [
    'ELECTRON_EXEC_PATH', 'ELECTRON_CLI_ARGS', 'ELECTRON_MAJOR_VER', 'ELECTRON_PA_APP_NAME', 'ELECTRON_RUN_AS_NODE',
    '__NV_PRIME_RENDER_OFFLOAD', '__GLX_VENDOR_LIBRARY_NAME', '__VK_LAYER_NV_optimus'
  ]) delete env[name]
  if (env.ROCKET_NO_SANDBOX === '1') env.ELECTRON_DISABLE_SANDBOX = '1'
  return env
}
