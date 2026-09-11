import type { IconType } from "react-icons";
import {
  LuDatabase,
  LuFile,
  LuFileArchive,
  LuFileCode,
  LuFileCog,
  LuFileImage,
  LuFileKey,
  LuFileMusic,
  LuFileSpreadsheet,
  LuFileTerminal,
  LuFileText,
  LuFileVideo,
  LuFolder,
  LuFolderOpen,
  LuType,
} from "react-icons/lu";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "pjpeg",
  "gif",
  "webp",
  "avif",
  "jxl",
  "bmp",
  "tiff",
  "tif",
  "svg",
  "heic",
  "heif",
  "ico",
  "psd",
  "psb",
  "xcf",
  "tga",
  "dds",
  "dng",
  "cr2",
  "nef",
  "arw",
  "orf",
  "rw2",
]);

const VECTOR_EXTENSIONS = new Set([
  "svg",
  "svgz",
  "ai",
  "eps",
  "ps",
  "cdr",
  "odg",
  "wmf",
  "emf",
  "sketch",
  "fig",
  "drawio",
  "vsd",
  "vsdx",
  "vss",
  "vssx",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "mkv",
  "avi",
  "webm",
  "wmv",
  "flv",
  "mpeg",
  "mpg",
  "m4v",
  "3gp",
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "flac",
  "aac",
  "ogg",
  "m4a",
  "opus",
  "wma",
  "aiff",
  "aif",
  "mid",
  "midi",
  "m4b",
  "m4r",
  "weba",
  "amr",
  "ra",
  "caf",
]);

const ARCHIVE_EXTENSIONS = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
  "zst",
  "lz",
  "lzma",
  "lz4",
  "tgz",
  "tbz",
  "tbz2",
  "cab",
  "zipx",
]);

const DISK_IMAGE_EXTENSIONS = new Set([
  "iso",
  "img",
  "dmg",
  "bin",
  "vcd",
  "mdf",
  "nrg",
  "cue",
]);

const SPREADSHEET_EXTENSIONS = new Set([
  "xls",
  "xlsx",
  "xlsm",
  "xlt",
  "xltx",
  "xltm",
  "csv",
  "tsv",
  "ods",
  "numbers",
]);

const PRESENTATION_EXTENSIONS = new Set([
  "ppt",
  "pptx",
  "pptm",
  "pps",
  "ppsx",
  "odp",
  "key",
]);

const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "docm",
  "rtf",
  "txt",
  "md",
  "markdown",
  "odt",
  "pages",
  "tex",
  "wpd",
  "wps",
]);

const EBOOK_EXTENSIONS = new Set(["epub", "mobi", "azw", "azw3"]);

const EMAIL_EXTENSIONS = new Set(["eml", "emlx", "msg", "pst", "ost", "mbox"]);

const SUBTITLE_EXTENSIONS = new Set(["srt", "vtt", "ass", "ssa", "sub"]);

const CODE_EXTENSIONS = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "php",
  "rs",
  "go",
  "java",
  "cs",
  "cpp",
  "c",
  "h",
  "hpp",
  "m",
  "mm",
  "swift",
  "kt",
  "kts",
  "gradle",
  "scala",
  "groovy",
  "dart",
  "r",
  "jl",
  "lua",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "psm1",
  "bat",
  "cmd",
  "sql",
  "html",
  "css",
  "scss",
  "sass",
  "less",
  "vue",
  "svelte",
  "astro",
  "json",
  "jsonc",
  "toml",
  "yaml",
  "yml",
  "xml",
]);

const CONFIG_EXTENSIONS = new Set([
  "ini",
  "cfg",
  "conf",
  "env",
  "config",
  "properties",
  "prefs",
]);

const DATABASE_EXTENSIONS = new Set([
  "db",
  "db3",
  "sqlite",
  "sqlite3",
  "mdb",
  "accdb",
  "dbf",
  "sdf",
  "pdb",
  "sqlitedb",
]);

const FONT_EXTENSIONS = new Set([
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "fon",
  "ttc",
]);

const LOG_EXTENSIONS = new Set(["log", "txt", "err", "out"]);

const KEY_EXTENSIONS = new Set([
  "key",
  "pem",
  "pfx",
  "p12",
  "crt",
  "cer",
  "der",
]);

const EXECUTABLE_EXTENSIONS = new Set([
  "exe",
  "msi",
  "apk",
  "app",
  "dmg",
  "bin",
  "run",
  "deb",
  "rpm",
]);

const SPECIAL_FILE_ICONS = new Map<string, IconType>([
  ["readme", LuFileText],
  ["readme.md", LuFileText],
  ["license", LuFileText],
  ["license.md", LuFileText],
  ["dockerfile", LuFileCode],
  ["makefile", LuFileCode],
  [".env", LuFileCog],
  [".gitignore", LuFileCode],
  [".npmrc", LuFileCog],
  [".bashrc", LuFileTerminal],
  [".zshrc", LuFileTerminal],
  ["package.json", LuFileCode],
  ["tsconfig.json", LuFileCode],
  ["vite.config.ts", LuFileCode],
  ["cargo.toml", LuFileCode],
  ["go.mod", LuFileCode],
]);

const getPathExtension = (path: string): string | null => {
  const lastDot = path.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === path.length - 1) return null;
  return path.slice(lastDot + 1).toLowerCase();
};

const resolveIconByName = (name: string): IconType | null => {
  const normalized = name.trim().toLowerCase();
  return SPECIAL_FILE_ICONS.get(normalized) ?? null;
};

const EXTENSION_ICON_MAP: Array<{ set: Set<string>; icon: IconType }> = [
  { set: IMAGE_EXTENSIONS, icon: LuFileImage },
  { set: VECTOR_EXTENSIONS, icon: LuFileImage },
  { set: VIDEO_EXTENSIONS, icon: LuFileVideo },
  { set: AUDIO_EXTENSIONS, icon: LuFileMusic },
  { set: ARCHIVE_EXTENSIONS, icon: LuFileArchive },
  { set: DISK_IMAGE_EXTENSIONS, icon: LuFileArchive },
  { set: SPREADSHEET_EXTENSIONS, icon: LuFileSpreadsheet },
  { set: PRESENTATION_EXTENSIONS, icon: LuFileText },
  { set: DOCUMENT_EXTENSIONS, icon: LuFileText },
  { set: EBOOK_EXTENSIONS, icon: LuFileText },
  { set: EMAIL_EXTENSIONS, icon: LuFileText },
  { set: SUBTITLE_EXTENSIONS, icon: LuFileText },
  { set: LOG_EXTENSIONS, icon: LuFileText },
  { set: DATABASE_EXTENSIONS, icon: LuDatabase },
  { set: FONT_EXTENSIONS, icon: LuType },
  { set: KEY_EXTENSIONS, icon: LuFileKey },
  { set: CONFIG_EXTENSIONS, icon: LuFileCog },
  { set: EXECUTABLE_EXTENSIONS, icon: LuFileTerminal },
  { set: CODE_EXTENSIONS, icon: LuFileCode },
];

const resolveIconByExtension = (ext: string): IconType | null => {
  for (let i = 0; i < EXTENSION_ICON_MAP.length; i += 1) {
    const entry = EXTENSION_ICON_MAP[i];
    if (entry?.set.has(ext)) return entry.icon;
  }
  return null;
};

export const getFileIcon = (path: string, name: string): IconType => {
  const nameIcon = resolveIconByName(name);
  if (nameIcon) return nameIcon;
  const ext = getPathExtension(path);
  if (!ext) return LuFile;
  return resolveIconByExtension(ext) ?? LuFile;
};

export const getFolderIcon = (isExpanded: boolean): IconType => {
  return isExpanded ? LuFolderOpen : LuFolder;
};
