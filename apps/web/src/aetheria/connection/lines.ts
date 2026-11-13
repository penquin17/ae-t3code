// This client's own words for each connection state (D6–D8), in both languages. Words that someone else wrote — the server's refusal message, T3's detail — are never here: the view carries them verbatim.
// Each line says what is known and nothing the facts do not support; in particular none names a differing module (the refusal carries digests, the module list comes from the composition status).
import type { Locale } from "./state";

const LINES = {
  disconnected: {
    en: "Not connected.",
    zh: "未连接。",
  },
  "disconnected:offline": {
    en: "This device is offline. Reconnecting when the network returns.",
    zh: "此设备已离线，网络恢复后将重新连接。",
  },
  connecting: {
    en: "Connecting to the Backend.",
    zh: "正在连接后端。",
  },
  "connecting:ready": {
    en: "Connected to the server; waiting for the Backend to report ready.",
    zh: "已连接服务器，正在等待后端就绪。",
  },
  "connecting:baseline": {
    en: "Connected to the server; waiting for the current state before showing anything as live.",
    zh: "已连接服务器，正在等待当前状态，之后才会显示为实时。",
  },
  "connecting:composition": {
    en: "Connected to the server; verifying which Backend build it runs.",
    zh: "已连接服务器，正在核对其运行的后端构建。",
  },
  "connecting:backend": {
    en: "The Backend is still starting.",
    zh: "后端仍在启动。",
  },
  connected: {
    en: "Connected. The Backend is ready and what you see is current.",
    zh: "已连接。后端已就绪，所见内容为最新。",
  },
  reconnecting: {
    en: "Connection lost. Reconnecting; what you see may be out of date, and actions are paused.",
    zh: "连接已断开，正在重新连接；所见内容可能已过时，操作已暂停。",
  },
  "reconnecting:ready": {
    en: "Reconnected to the server; waiting for the Backend to report ready. What you see may be out of date.",
    zh: "已重新连接服务器，正在等待后端就绪；所见内容可能已过时。",
  },
  "reconnecting:baseline": {
    en: "Reconnected; waiting for the current state. What you see may be out of date, and actions are paused.",
    zh: "已重新连接，正在等待当前状态；所见内容可能已过时，操作已暂停。",
  },
  "reconnecting:composition": {
    en: "Reconnected; verifying which Backend build the server runs.",
    zh: "已重新连接，正在核对服务器运行的后端构建。",
  },
  "reconnecting:backend": {
    en: "Reconnected; the Backend is still starting.",
    zh: "已重新连接，后端仍在启动。",
  },
  unauthorized: {
    en: "The server did not accept this device's sign-in. Sign in or pair this device again.",
    zh: "服务器未接受此设备的登录。请重新登录或重新配对此设备。",
  },
  "access-ended": {
    en: "This device's access was revoked or has expired (the Backend does not say which). Sign in or pair again to continue.",
    zh: "此设备的访问权限已被撤销或已过期（后端未说明是哪一种）。请重新登录或重新配对后继续。",
  },
  "version-mismatch:digest-mismatch": {
    en: "This server's Backend does not match this client's build. Reload to get the matching client.",
    zh: "此服务器的后端与本客户端的构建不匹配。请重新加载以获取匹配的客户端。",
  },
  "version-mismatch:digest-absent": {
    en: "This server publishes no Backend build identity, so this client cannot verify it. Actions are blocked.",
    zh: "此服务器未发布后端构建标识，本客户端无法核实。操作已被阻止。",
  },
  "version-mismatch:digest-malformed": {
    en: "The server could not read the build identity this client declared. Actions are blocked; reload.",
    zh: "服务器无法读取本客户端声明的构建标识。操作已被阻止，请重新加载。",
  },
  "version-mismatch:digest-differs": {
    en: "The Backend's reported build differs from the one this client was built for. Actions are blocked; reload.",
    zh: "后端报告的构建与本客户端所对应的构建不同。操作已被阻止，请重新加载。",
  },
  "version-mismatch:protocol": {
    en: "This client and the server do not speak the same protocol version. Reload, or update whichever is older.",
    zh: "本客户端与服务器的协议版本不一致。请重新加载，或更新较旧的一方。",
  },
  "version-mismatch:client-digest-absent": {
    en: "This client was built without the Backend build identity it must check, so it cannot confirm it matches the server. Actions are blocked.",
    zh: "本客户端构建时未包含必须核对的后端构建标识，无法确认与服务器匹配。操作已被阻止。",
  },
  "version-mismatch:client-digest-malformed": {
    en: "The Backend build identity in this client is not valid, so it cannot confirm it matches the server. Actions are blocked.",
    zh: "本客户端内的后端构建标识无效，无法确认与服务器匹配。操作已被阻止。",
  },
  "unknown:unrecognised-refusal": {
    en: "The server refused the connection in a way this client does not recognise. Nothing is assumed; actions are blocked.",
    zh: "服务器以本客户端无法识别的方式拒绝了连接。不作任何假设，操作已被阻止。",
  },
  "unknown:composition-unread": {
    en: "The Backend's build could not be read, so the version is unverified. Actions are blocked; reload.",
    zh: "无法读取后端的构建信息，版本未经核实。操作已被阻止，请重新加载。",
  },
  "unknown:backend-not-running": {
    en: "The Backend reports it is not running. Actions are blocked.",
    zh: "后端报告其未在运行。操作已被阻止。",
  },
  "unknown:configuration": {
    en: "The connection is blocked by a configuration problem. Actions are blocked.",
    zh: "连接被配置问题阻止。操作已被阻止。",
  },
} as const satisfies Record<string, Record<Locale, string>>;

export type LineKey = keyof typeof LINES;

/** The line for a state: its `kind:cause` line, else the kind's own line, else the plainest one. */
export function lineFor(kind: string, cause: string | undefined, locale: Locale): string {
  const specific = cause === undefined ? undefined : `${kind}:${cause}`;
  const key = (
    specific !== undefined && Object.hasOwn(LINES, specific) ? specific : kind
  ) as string;
  const line = Object.hasOwn(LINES, key) ? LINES[key as LineKey] : LINES.disconnected;
  return line[locale];
}
