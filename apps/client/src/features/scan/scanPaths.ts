const isWindowsPath = (path: string): boolean => /^[a-z]:[/\\]|^\\\\/i.test(path);

export const pathKey = (path: string): string => {
  const value = isWindowsPath(path) ? path.replaceAll("\\", "/").toLowerCase() : path;
  return value.replace(/\/+$/, "") || "/";
};

export const containsPath = (parent: string, path: string): boolean => {
  const key = pathKey(parent);
  const candidate = pathKey(path);
  return candidate === key || candidate.startsWith(key.endsWith("/") ? key : `${key}/`);
};

export const parentPath = (path: string): string | null => {
  const value = path.replace(isWindowsPath(path) ? /[/\\]+$/ : /\/+$/, "");
  const index = isWindowsPath(path) ? Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) : value.lastIndexOf("/");
  if (index < 0) return null;
  if (index === 0 || (isWindowsPath(path) && index === 2)) return value.slice(0, index + 1);
  return value.slice(0, index);
};

export const pathName = (path: string): string => {
  const parent = parentPath(path);
  return parent ? path.slice(parent.length).replace(/^[/\\]/, "") : path;
};

export const relocatePath = (path: string, source: string, destination: string): string => {
  if (!containsPath(source, path)) return path;
  const sourceLength = source.replace(/[/\\]+$/, "").length;
  return destination.replace(/[/\\]+$/, "") + path.slice(sourceLength);
};
