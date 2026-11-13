// One English and one Chinese display line per canonical refusal code (D14). A line says in plain words what the code's class means; the Backend's own message is shown beside it, verbatim, by
// the view. "Nothing was changed." appears only for a class that promises it (refused-unchanged, failed-unchanged); an applied-with-warning code says the work was done with a warning; an
// interaction or children code never claims "nothing changed", because its class does not promise it. Meanings come from the sources named in canonical.ts.
import type { DisplayLines } from "./drift";

const NC_EN = " Nothing was changed.";
const NC_ZH = "没有任何改动。";

export const LINES: DisplayLines = {
  // M04, A6 readiness: the governing instruction chain
  READINESS_NOT_LOADED: {
    en: `The instructions that govern this file have not all been shown to the agent yet, so the write was refused. They are queued for its next request.${NC_EN}`,
    zh: `约束该文件的指令还没有全部呈现给智能体，所以拒绝了这次写入。它们已排入下一次请求。${NC_ZH}`,
  },
  READINESS_CHANGED: {
    en: `The governing instructions changed after the call was checked, so the write was refused.${NC_EN}`,
    zh: `在检查该调用之后，约束它的指令发生了变化，所以拒绝了这次写入。${NC_ZH}`,
  },
  READINESS_RETARGETED: {
    en: `The target now points to a different file than the one that was checked, so the write was refused.${NC_EN}`,
    zh: `目标现在指向了与检查时不同的文件，所以拒绝了这次写入。${NC_ZH}`,
  },
  READINESS_UNSUPPORTED_SCOPE: {
    en: `Whether the instructions are in place cannot be assessed for this target (no file path, a folder that is not a directory, or no file system available), so the write was refused.${NC_EN}`,
    zh: `无法评估该目标的指令是否就位（没有文件路径、上级不是目录，或没有可用的文件系统），所以拒绝了这次写入。${NC_ZH}`,
  },
  READINESS_ANCESTOR_LIMIT: {
    en: `The target is more than 128 folder levels below its root, so the write was refused.${NC_EN}`,
    zh: `目标位于其根目录之下超过 128 层，所以拒绝了这次写入。${NC_ZH}`,
  },
  READINESS_UNREADABLE: {
    en: `An instruction source cannot be listed or read as plain text (a broken link, a file that is not regular, a binary file or an unreadable folder), so the write was refused.${NC_EN}`,
    zh: `某个指令来源无法列出或作为纯文本读取（链接已失效、不是普通文件、二进制文件或无法读取的文件夹），所以拒绝了这次写入。${NC_ZH}`,
  },
  READINESS_TOO_LARGE: {
    en: `An instruction source, or the instructions for one target together, are larger than the 65,536-byte limit, so the write was refused.${NC_EN}`,
    zh: `某个指令来源，或同一目标的指令合计，超过了 65536 字节的上限，所以拒绝了这次写入。${NC_ZH}`,
  },
  READINESS_UNSTABLE: {
    en: `An instruction source changed while it was being read, so the write was refused.${NC_EN}`,
    zh: `某个指令来源在读取过程中发生了变化，所以拒绝了这次写入。${NC_ZH}`,
  },
  // M04, T1 freshness and the write's own outcome
  T1_NOT_OBSERVED: {
    en: `This session has not read the file yet, so the write was refused. Read it first.${NC_EN}`,
    zh: `本会话还没有读过该文件，所以拒绝了这次写入。请先读取它。${NC_ZH}`,
  },
  T1_STALE: {
    en: `The file changed or was deleted since this session read it, so the write was refused. Read it again.${NC_EN}`,
    zh: `自本会话读取以来，该文件已被修改或删除，所以拒绝了这次写入。请重新读取。${NC_ZH}`,
  },
  T1_EXISTS: {
    en: `The file was seen to be absent but now exists, so the write was refused.${NC_EN}`,
    zh: `该文件先前不存在，现在已存在，所以拒绝了这次写入。${NC_ZH}`,
  },
  T1_NOT_FOUND: {
    en: `The file to edit is absent, or was deleted after it was read, so the edit was refused.${NC_EN}`,
    zh: `要编辑的文件不存在，或在读取之后被删除，所以拒绝了这次编辑。${NC_ZH}`,
  },
  T1_RETARGETED: {
    en: `A symbolic link now points to a different file than when it was read, so the write was refused.${NC_EN}`,
    zh: `符号链接现在指向的文件与读取时不同，所以拒绝了这次写入。${NC_ZH}`,
  },
  T1_DANGLING_LINK: {
    en: `The path is a link whose target does not exist, and a write never creates a file through a link, so it was refused.${NC_EN}`,
    zh: `该路径是目标不存在的链接，写入不会通过链接创建文件，所以被拒绝。${NC_ZH}`,
  },
  T1_WRITE_BUSY: {
    en: `Another writer holds the lock on this target, so the write was refused. Retry it explicitly; nothing is queued.${NC_EN}`,
    zh: `另一个写入者正持有该目标的锁，所以拒绝了这次写入。请明确重试，系统不会排队。${NC_ZH}`,
  },
  T1_IS_DIRECTORY: {
    en: `The target is a directory or another kind of file that is not a regular file, so the write was refused.${NC_EN}`,
    zh: `目标是目录或其他非普通文件，所以拒绝了这次写入。${NC_ZH}`,
  },
  T1_LINK_LOOP: {
    en: `The path goes through a loop of symbolic links, so no file can be resolved and the write was refused.${NC_EN}`,
    zh: `该路径经过符号链接的循环，无法解析到任何文件，所以拒绝了这次写入。${NC_ZH}`,
  },
  T1_OBSERVATION_DROPPED: {
    en: "The write was applied, but this session's record of the file could not be updated and was dropped. Read the file again before editing it.",
    zh: "写入已经生效，但本会话对该文件的记录无法更新，已被丢弃。再次编辑前请重新读取该文件。",
  },
  WRITE_FAILED: {
    en: `The write itself failed (the temporary file, disk space, permission or a cancel before the rename), so the target is unchanged and the temporary file was removed.${NC_EN}`,
    zh: `写入本身失败了（临时文件、磁盘空间、权限，或在重命名前被取消），目标保持原样，临时文件已清除。${NC_ZH}`,
  },
  // M04, H5 awareness board
  AWARENESS_HELD: {
    en: `Another active session holds this path, so the write was refused.${NC_EN}`,
    zh: `另一个活跃会话正占用该路径，所以拒绝了这次写入。${NC_ZH}`,
  },
  AWARENESS_LEFTOVER: {
    en: `A closed or crashed session left unfinished work on this path, so the write was refused.${NC_EN}`,
    zh: `一个已关闭或已崩溃的会话在该路径上留下了未完成的工作，所以拒绝了这次写入。${NC_ZH}`,
  },
  AWARENESS_ASSIGNED: {
    en: `This path is assigned to a different agent than the one writing, so the write was refused.${NC_EN}`,
    zh: `该路径被分配给了与写入者不同的智能体，所以拒绝了这次写入。${NC_ZH}`,
  },
  AWARENESS_UNAVAILABLE: {
    en: `The coordination board cannot be read and this workspace refuses writes in that case, or a board action found it unavailable, so it was refused.${NC_EN}`,
    zh: `无法读取协调看板，而该工作区在这种情况下拒绝写入；或者看板操作发现看板不可用，所以被拒绝。${NC_ZH}`,
  },
  AWARENESS_OVERLAP: {
    en: `This claim overlaps a path another session holds, so it was refused.${NC_EN}`,
    zh: `该声明与另一个会话占用的路径重叠，所以被拒绝。${NC_ZH}`,
  },
  AWARENESS_INVALID: {
    en: `A board action argument is invalid (the Backend's message names the field), so it was refused.${NC_EN}`,
    zh: `看板操作的某个参数无效（后端消息会指出是哪个字段），所以被拒绝。${NC_ZH}`,
  },
  AWARENESS_STALE: {
    en: `A board record was based on out-of-date state, so the action was refused.${NC_EN}`,
    zh: `看板记录基于过期的状态，所以拒绝了这次操作。${NC_ZH}`,
  },
  AWARENESS_UNVERIFIED: {
    en: `A recorded fact could not be verified, so the action was refused.${NC_EN}`,
    zh: `记录的某项事实无法核实，所以拒绝了这次操作。${NC_ZH}`,
  },
  AWARENESS_NO_SESSION: {
    en: `The session is not open on the board, or has no root or working directory, so there was nothing to act on and the action was refused.${NC_EN}`,
    zh: `该会话未在看板上打开，或没有根目录或工作目录，没有可操作的对象，所以拒绝了这次操作。${NC_ZH}`,
  },
  AWARENESS_NO_AGENT: {
    en: `The board action needs a calling agent, or the agent's depth could not be read, so it was refused.${NC_EN}`,
    zh: `该看板操作需要一个调用它的智能体，或无法读取智能体的层级，所以被拒绝。${NC_ZH}`,
  },
  AWARENESS_NOT_MAIN: {
    en: `This board action is for the main agent only, so it was refused.${NC_EN}`,
    zh: `该看板操作只限主智能体使用，所以被拒绝。${NC_ZH}`,
  },
  COORDINATION_UNAVAILABLE: {
    en: "The write was applied, but the coordination board could not be reached or the edit was not recorded, so the coordination record is missing.",
    zh: "写入已经生效，但无法连接协调看板，或这次编辑没有被记录，因此协调记录缺失。",
  },
  // M03, authority
  AUTH_IDENTITY_UNAVAILABLE: {
    en: `This session has no usable identity record (it is missing, pending, retired or not derived yet), so no Aetheria tool runs and the session is never treated as the main one.${NC_EN}`,
    zh: `本会话没有可用的身份记录（缺失、待定、已退役或尚未生成），所以不会运行任何 Aetheria 工具，也不会把它当作主会话。${NC_ZH}`,
  },
  AUTH_IDENTITY_INVALID: {
    en: `This session's identity record is corrupt or does not name this session, so no Aetheria tool runs.${NC_EN}`,
    zh: `本会话的身份记录已损坏，或没有指向本会话，所以不会运行任何 Aetheria 工具。${NC_ZH}`,
  },
  AUTH_ROLE_REMOVED: {
    en: `This session's role is no longer defined, so no Aetheria tool runs.${NC_EN}`,
    zh: `本会话的角色已不再定义，所以不会运行任何 Aetheria 工具。${NC_ZH}`,
  },
  AUTH_TOOL_NOT_ALLOWED: {
    en: `The tool is not in this session's allowed set, or no delegated session holds that capability, so the call was refused.${NC_EN}`,
    zh: `该工具不在本会话允许使用的范围内，或这是任何委派会话都不具备的能力，所以拒绝了这次调用。${NC_ZH}`,
  },
  AUTH_DEPTH_EXCEEDED: {
    en: `Starting this role would put a child past the role's maximum depth, so it was refused.${NC_EN}`,
    zh: `启动该角色会使子会话超过该角色允许的最大层级，所以被拒绝。${NC_ZH}`,
  },
  ROLE_PROJECT_LAYER: {
    en: `The tool belongs to a project-layer role that is not available in this project, so the call was refused.${NC_EN}`,
    zh: `该工具属于项目层角色，而这个项目中没有该角色，所以拒绝了这次调用。${NC_ZH}`,
  },
  ROLE_GENERIC_DELEGATION: {
    en: `A generic delegation tool is not available to a delegated role, so the call was refused.${NC_EN}`,
    zh: `通用的委派工具不对被委派的角色开放，所以拒绝了这次调用。${NC_ZH}`,
  },
  // T3: a decline, which has no code
  T3_DECLINE: {
    en: `The tool call was declined in T3 Code. This is a decision, not a confinement.${NC_EN}`,
    zh: `这次工具调用在 T3 Code 中被拒绝。这是一项决定，而不是隔离措施。${NC_ZH}`,
  },
  // M06, the interaction codes
  INTERACTION_ORIGIN_NOT_HUMAN: {
    en: "This decision did not come from a signed-in person on an authorized device, so it was refused.",
    zh: "这项决定并非来自已登录且获授权设备上的真人，所以被拒绝。",
  },
  INTERACTION_REVIEW_NOT_PERMITTED: {
    en: "This session's role or authority does not allow this review to be decided here, so it was refused.",
    zh: "本会话的角色或权限不允许在此处决定这项审阅，所以被拒绝。",
  },
  INTERACTION_NOT_IN_PLAN_MODE: {
    en: "The session is not in plan mode, so there is no plan to decide.",
    zh: "该会话不在计划模式下，所以没有可决定的计划。",
  },
  INTERACTION_ANSWER_INVALID: {
    en: "The answer does not fit the question (an option that does not exist, a missing answer or too many). Check it and send it again.",
    zh: "答案与问题不匹配（选项不存在、缺少答案或答案过多）。请检查后重新提交。",
  },
  INTERACTION_GRANT_INVALID: {
    en: "This authorization cannot be granted as requested, so the grant was refused.",
    zh: "无法按所请求的内容授予这项授权，所以授权被拒绝。",
  },
  INTERACTION_ALREADY_SETTLED: {
    en: "This question or review was already settled, so this decision was not applied. The card shows what settled it.",
    zh: "这个问题或审阅已经有了结果，所以这项决定没有被采用。卡片显示了是谁、如何结束的。",
  },
  INTERACTION_STALE_REVISION: {
    en: "The question or plan changed after you opened it, so your decision does not apply to the new version. Review the new version; your earlier text is kept.",
    zh: "你打开之后，问题或计划已经更新，所以你的决定不适用于新版本。请查看新版本；你之前输入的内容已保留。",
  },
  ORIGIN_STALE: {
    en: "The decision this refers to was replaced by a newer version.",
    zh: "这里所指的决定已被更新的版本取代。",
  },
  INTERACTION_NOT_FOUND: {
    en: "This question, review or session is not available to this device. It may not exist, or this device may not be allowed to see it.",
    zh: "此设备无法获取这个问题、审阅或会话。它可能不存在，或此设备无权查看。",
  },
  ORIGIN_NOT_FOUND: {
    en: "No record of this human decision was found.",
    zh: "没有找到这项人工决定的记录。",
  },
  ORIGIN_MISMATCH: {
    en: "This decision record does not match what was expected (a different kind, subject or session).",
    zh: "这项决定记录与预期不符（类型、对象或会话不同）。",
  },
  INTERACTION_UNAVAILABLE: {
    en: "The Backend could not complete this, and it is not known whether the decision was applied. Check the current state before acting again; it was not sent again.",
    zh: "后端未能完成这项操作，且不清楚这项决定是否已生效。请先查看当前状态再决定是否重做；它没有被重新发送。",
  },
  INTERACTION_DELIVERY_FAILED: {
    en: "Your decision was recorded, but delivering it to the agent failed. The record keeps it.",
    zh: "你的决定已被记录，但把它送达智能体时失败了。记录中保留着这项决定。",
  },
  INTERACTION_FORMAT_UNSUPPORTED: {
    en: "The stored interaction data is in a format this build does not support, so it cannot be shown or changed.",
    zh: "已存储的交互数据所用格式不受此版本支持，因此无法显示或修改。",
  },
  // M10, the user's children controls
  CHILDREN_NOT_AUTHORIZED: {
    en: "This device cannot stop work: its access is read-only.",
    zh: "此设备不能停止工作：它的访问权限是只读的。",
  },
  CHILDREN_DEVICE_REVOKED: {
    en: "This device's access was revoked or has expired. Pair or sign in again to continue.",
    zh: "此设备的访问权限已被撤销或已过期。请重新配对或登录后继续。",
  },
  CHILDREN_NOT_FOUND: {
    en: "That session is not available to this device.",
    zh: "此设备无法获取该会话。",
  },
  CHILDREN_UNAVAILABLE: {
    en: "The Backend could not take the request, and it did nothing.",
    zh: "后端无法受理这项请求，也没有做任何操作。",
  },
  CHILDREN_OUTCOME_UNKNOWN: {
    en: "It is not known whether the request took effect. It was not sent again; check the current state.",
    zh: "不清楚这项请求是否已生效。它没有被重新发送，请查看当前状态。",
  },
  // M10, the session-group store's own codes
  GROUPS_INVALID_REQUEST: {
    en: "The Backend did not accept this group change as written.",
    zh: "后端不接受这项按原样提交的分组更改。",
  },
  GROUPS_REQUEST_TOO_LARGE: {
    en: "This group change is larger than one request may be (8 KiB), so the Backend did not accept it.",
    zh: "这项分组更改超过单次请求的上限（8 KiB），后端没有接受。",
  },
  GROUPS_NOT_AUTHORIZED: {
    en: "This device is not allowed to change groups.",
    zh: "此设备无权更改分组。",
  },
  GROUPS_DEVICE_REVOKED: {
    en: "This device's sign-in was revoked or has expired, so the Backend refused the request.",
    zh: "此设备的登录已被撤销或已过期，后端拒绝了这项请求。",
  },
  GROUPS_SESSION_NOT_FOUND: {
    en: "One of those sessions is not available to this device.",
    zh: "其中一个会话此设备无法获取。",
  },
  GROUPS_STORE_UNUSABLE: {
    en: "The saved groups cannot be used right now: the file could not be read, is in an unsupported form, or could not be written. The Backend left it as it was.",
    zh: "目前无法使用已保存的分组：文件无法读取、格式不受支持或无法写入。后端保持其原样。",
  },
  GROUPS_UNAVAILABLE: {
    en: "The Backend could not take the request.",
    zh: "后端无法受理这项请求。",
  },
  GROUPS_OUTCOME_UNKNOWN: {
    en: "It is not known whether the group change took effect. It was not sent again; check the groups as they are now.",
    zh: "不清楚这项分组更改是否已生效。它没有被重新发送，请查看分组的当前状态。",
  },
  // M10, the user's jobs controls (zh lines are unreviewed, as the others)
  JOBS_NOT_AUTHORIZED: {
    en: "This device is not allowed to do that to jobs: reading jobs needs read access, and a Kill needs operate access.",
    zh: "此设备无权对作业执行该操作：查看作业需要读取权限，终止作业需要操作权限。",
  },
  JOBS_DEVICE_REVOKED: {
    en: "This device's access was revoked or has expired, so the Backend refused the request. Pair or sign in again to continue.",
    zh: "此设备的访问权限已被撤销或已过期，后端拒绝了这项请求。请重新配对或登录后继续。",
  },
  JOBS_NOT_FOUND: {
    en: "That job, or the session it belongs to, is not available to this device.",
    zh: "此设备无法获取该作业，或它所属的会话。",
  },
  JOBS_UNAVAILABLE: {
    en: "The Backend could not read or act on jobs just now. A read shows nothing it did not read; for a Kill, the Backend's own words say what was not done.",
    zh: "后端目前无法读取或操作作业。读取不会显示未读到的内容；对于终止，请以后端自己的说明为准。",
  },
  JOBS_OUTCOME_UNKNOWN: {
    en: "It is not known whether the Kill took effect: the job may already be ended. It was not sent again; read the job list for the job's state.",
    zh: "不清楚终止是否已生效：该作业可能已经结束。它没有被重新发送，请查看作业列表中该作业的状态。",
  },
  // M10, the usage read's own codes
  USAGE_NOT_AUTHORIZED: {
    en: "This device is not allowed to read route availability and usage: its access does not include reading.",
    zh: "此设备无权读取线路可用性和用量：它的访问权限不包含读取。",
  },
  USAGE_DEVICE_REVOKED: {
    en: "This device's access was revoked or has expired, so the Backend refused the request. Pair or sign in again to continue.",
    zh: "此设备的访问权限已被撤销或已过期，后端拒绝了这项请求。请重新配对或登录后继续。",
  },
  USAGE_NOT_FOUND: {
    en: "That session is not available to this device, so no route availability or usage was read for it.",
    zh: "此设备无法获取该会话，所以没有为它读取线路可用性和用量。",
  },
  USAGE_UNAVAILABLE: {
    en: "The Backend could not read route availability and usage just now. Nothing shown is a guess: what was not read is not shown as 0.",
    zh: "后端目前无法读取线路可用性和用量。显示的内容都不是猜测：未读到的部分不会显示为 0。",
  },
  // M05, passed through the jobs handler
  JOB_NOT_FOUND: {
    en: "No such job under this session: it may never have existed, or it belongs to another session.",
    zh: "本会话下没有这个作业：它可能从未存在，或属于另一个会话。",
  },
  JOB_CONFLICT: {
    en: "The job's recorded state does not allow that now, so the Backend did not carry it out. Read the job list for the job's state.",
    zh: "作业当前记录的状态不允许此操作，后端没有执行。请查看作业列表中该作业的状态。",
  },
  JOB_IDENTITY_MISMATCH: {
    en: "The process now running under the job's recorded id is not the one that was started, so the Backend did not signal it. Read the job list for the job's state.",
    zh: "目前占用该作业记录编号的进程不是当初启动的那个，所以后端没有向它发送信号。请查看作业列表中该作业的状态。",
  },
  // M05, passed through the children handler
  NOT_AUTHORIZED: {
    en: "This session is not allowed to do that to its children.",
    zh: "本会话无权对其子会话执行该操作。",
  },
  CHILD_NOT_OWNED: {
    en: "That child does not belong to this session.",
    zh: "该子会话不属于本会话。",
  },
  CHILD_NOT_ADJACENT: {
    en: "That child is not one this session may act on directly.",
    zh: "该子会话不是本会话可以直接操作的对象。",
  },
  CHILD_NOT_RESUMABLE: {
    en: "That child cannot be interrupted and continued; a one-shot child can be closed instead.",
    zh: "该子会话无法被中断后继续；一次性的子会话可以改为关闭。",
  },
  CHILD_DELIVERY_UNAVAILABLE: {
    en: "The child's result cannot be delivered to its parent right now.",
    zh: "目前无法把该子会话的结果送达它的父会话。",
  },
  CHILD_PARENT_UNAVAILABLE: {
    en: "The child's parent session is not available right now.",
    zh: "该子会话的父会话目前不可用。",
  },
  ORCHESTRATION_UNAVAILABLE: {
    en: "The service that manages child sessions is not available, and it is not known whether the request took effect. Check the current state.",
    zh: "管理子会话的服务目前不可用，且不清楚这项请求是否已生效。请查看当前状态。",
  },
};
