export async function loadPackage(
  packageName: string,
  context?: string,
  loaderFn?: () => Promise<any> | any,
) {
  try {
    return loaderFn ? await loaderFn() : require(packageName);
  } catch {
    return null;
  }
}

export function loadPackageSync(
  packageName: string,
  context?: string,
  loaderFn?: () => any,
) {
  try {
    return loaderFn ? loaderFn() : require(packageName);
  } catch {
    return null;
  }
}

export function loadPackageCached(packageName: string, context?: string) {
  try {
    return require(packageName);
  } catch {
    return null;
  }
}

export async function tryLoadPackage(
  packageName: string,
  loaderFn?: () => Promise<any> | any,
) {
  try {
    return loaderFn ? await loaderFn() : require(packageName);
  } catch {
    return null;
  }
}
